import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const PROGRESS_PATH = join(DATA_DIR, 'batch-scrape-popular-progress.json');

const DELAY_MS = 3000;
const DELAY_AFTER_LIMIT = 60000;
const MAX_RETRIES = 5;
const MAX_PAGES = 10;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
        },
      });
      const text = await response.text();
      if (text.startsWith('<')) throw new Error('HTML/WAF');
      const data = JSON.parse(text);
      if (data.code === 0) return data;
      if (data.code === -799 || data.code === -412) {
        console.log(`  Rate limited, waiting ${DELAY_AFTER_LIMIT/1000}s...`);
        await wait(DELAY_AFTER_LIMIT);
        continue;
      }
      throw new Error(`API ${data.code}: ${data.message}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.log(`  Retry ${attempt}: ${err.message}`);
      await wait(DELAY_AFTER_LIMIT);
    }
  }
}

async function getPopularVideos(pn = 1) {
  const url = `https://api.bilibili.com/x/web-interface/popular?ps=20&pn=${pn}`;
  const data = await fetchJson(url);
  return data?.data?.list || [];
}

async function getVideoReplies(aid, pn = 1) {
  const url = `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=${pn}&ps=20&sort=1`;
  return fetchJson(url);
}

async function loadDatabase() {
  try { return JSON.parse(await readFile(USER_DB_PATH, 'utf8')); }
  catch { return { users: {}, lastUpdated: null }; }
}

async function saveDatabase(db) {
  await mkdir(dirname(USER_DB_PATH), { recursive: true });
  db.lastUpdated = new Date().toISOString();
  await writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function loadProgress() {
  try { return JSON.parse(await readFile(PROGRESS_PATH, 'utf8')); }
  catch { return { scraped: 0, videosScanned: 0, pagesScanned: 0, startTime: new Date().toISOString() }; }
}

async function saveProgress(progress) {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true });
  await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
}

function addCommentToUser(db, mid, name, reply, aid) {
  if (!db.users[mid]) {
    db.users[mid] = {
      uid: mid,
      name,
      commentCount: 0,
      danmakuCount: 0,
      commentText: '',
      danmakuText: '',
      combinedText: '',
      comments: [],
      danmaku: [],
      scrapedAt: new Date().toISOString(),
    };
  }
  const user = db.users[mid];
  const msg = reply.content?.message || '';
  if (msg && !user.comments.some(c => c.rpid === String(reply.rpid))) {
    user.comments.push({
      rpid: String(reply.rpid),
      message: msg,
      time: reply.ctime,
      oid: String(aid),
      type: 1,
    });
    user.commentCount = user.comments.length;
    user.commentText = user.comments.map(c => c.message).join('\n');
    user.combinedText = user.commentText;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let maxPages = 50;

  for (const arg of args) {
    if (arg.startsWith('--pages=')) maxPages = parseInt(arg.split('=')[1]);
  }

  const db = await loadDatabase();
  const progress = await loadProgress();
  const startPage = (progress.pagesScanned || 0) + 1;

  console.log(`=== Popular Video Comment Scanner ===`);
  console.log(`Database: ${Object.keys(db.users).length} users`);
  console.log(`Pages: ${startPage}-${maxPages}`);
  console.log(`Previously scanned: ${progress.videosScanned} videos\n`);

  let totalNewUsers = 0;
  let totalComments = 0;

  for (let pn = startPage; pn <= maxPages; pn++) {
    console.log(`\n=== Page ${pn}/${maxPages} ===`);
    let videos;
    try {
      videos = await getPopularVideos(pn);
    } catch (err) {
      console.log(`Failed: ${err.message}`);
      break;
    }
    if (!videos.length) break;

    for (const video of videos) {
      const aid = video.aid;
      const title = (video.title || '').slice(0, 50);
      process.stdout.write(`  ${title} `);

      let newCount = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        let data;
        try {
          data = await getVideoReplies(aid, page);
        } catch (err) {
          break;
        }

        const replies = data?.data?.replies || [];
        if (!replies.length) break;

        for (const reply of replies) {
          const mid = String(reply.member?.mid || '');
          if (!mid) continue;
          const isNew = !db.users[mid];
          const name = reply.member?.uname || `UID ${mid}`;
          addCommentToUser(db, mid, name, reply, aid);
          if (isNew) { newCount++; totalNewUsers++; }
          totalComments++;
        }

        // Also collect replies from sub-replies
        for (const reply of replies) {
          if (reply.replies) {
            for (const sub of reply.replies) {
              const mid = String(sub.member?.mid || '');
              if (!mid) continue;
              const isNew = !db.users[mid];
              const name = sub.member?.uname || `UID ${mid}`;
              addCommentToUser(db, mid, name, sub, aid);
              if (isNew) { newCount++; totalNewUsers++; }
              totalComments++;
            }
          }
        }

        await wait(DELAY_MS);
        if (replies.length < 20) break;
      }

      progress.videosScanned++;
      process.stdout.write(`→ +${newCount} users\n`);
    }

    progress.pagesScanned = pn;
    await saveDatabase(db);
    await saveProgress(progress);

    const users = Object.keys(db.users).length;
    const withComments = Object.values(db.users).filter(u => u.commentCount > 0).length;
    console.log(`  DB: ${users} users (${withComments} with comments), ${totalNewUsers} new this run`);
  }

  progress.endTime = new Date().toISOString();
  await saveProgress(progress);

  console.log(`\n=== Complete ===`);
  console.log(`New users: ${totalNewUsers}`);
  console.log(`Comments processed: ${totalComments}`);
  console.log(`Total in database: ${Object.keys(db.users).length}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
