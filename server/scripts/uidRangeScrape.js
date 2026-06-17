import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchJson, fetchRepliesForVideo, humanPause } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const START = Number(args.start || 1);
const END = Number(args.end || 100000);
const PROGRESS_FILE = args.progress || `uid-range-progress-${START}-${END}.json`;
const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, PROGRESS_FILE);
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const VIDEOS_PER_USER = 3;
const COMMENT_PAGES_PER_VIDEO = 1;
const DELAY_BETWEEN_UIDS_MS = 2500;
const DELAY_BETWEEN_REQUESTS_MS = 800;
const LOCK_RETRY_DELAY_MS = 10000;
const LOCK_MAX_RETRIES = 10;
const SAVE_EVERY = 20;
const BLOCK_BACKOFF_MS = 30000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err?.message || err);
});

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function trainWithRetry(payload, options, maxRetries = LOCK_MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await trainKeywordDictionary(payload, options);
    } catch (error) {
      if ((error.message || '').includes('lock')) {
        console.log(`  Lock held, retry ${attempt}/${maxRetries}...`);
        await wait(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

async function fetchUserVideos(uid) {
  const url = `https://api.bilibili.com/x/space/arc/list?mid=${uid}&pn=1&ps=${VIDEOS_PER_USER}&order=pubdate`;
  const data = await fetchJson(url, `https://space.bilibili.com/${uid}`);
  if (data.code !== 0) {
    if (data.code === -799 || data.code === -352) throw { blocked: true, code: data.code, message: data.message };
    throw new Error(data.message || `code ${data.code}`);
  }
  return (data.data?.archives || []).map(v => ({
    bvid: v.bvid,
    aid: v.aid,
    title: v.title || '',
    sourceUrl: `https://www.bilibili.com/video/${v.bvid}/`,
  }));
}

async function fetchUserCard(uid) {
  const url = `https://api.bilibili.com/x/web-interface/card?mid=${uid}`;
  const data = await fetchJson(url, 'https://www.bilibili.com');
  if (data.code !== 0) throw new Error(`card code ${data.code}`);
  return data.data?.card || null;
}

async function fetchVideoComments(video) {
  try {
    const scan = await fetchRepliesForVideo(video.sourceUrl || video.bvid, { pages: COMMENT_PAGES_PER_VIDEO });
    if (scan.ok && scan.comments.length > 0) {
      return scan.comments;
    }
  } catch {}
  return [];
}

async function main() {
  const total = END - START + 1;
  const progress = await loadJson(PROGRESS_PATH, {
    processed: {},
    stats: { success: 0, noComments: 0, noVideos: 0, errors: 0, blocked: 0 },
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });
  const processedCount = Object.keys(progress.processed).length;

  console.log(`UID Range Scraper: ${START}-${END} (${total} UIDs)`);
  console.log(`Previously processed: ${processedCount}\n`);

  let batchCount = 0;
  let consecutiveBlocks = 0;

  console.log(`Starting loop from UID ${START}...`);
  for (let uid = START; uid <= END; uid++) {
    const uidStr = String(uid);
    if (progress.processed[uidStr]) continue;
    if (uid === START || uid === START + 1) console.log(`Processing UID ${uid}...`);

    // Back off if too many consecutive blocks
    if (consecutiveBlocks >= 3) {
      const backoff = BLOCK_BACKOFF_MS * Math.min(consecutiveBlocks, 10);
      console.log(`  Backing off ${backoff / 1000}s after ${consecutiveBlocks} blocks...`);
      await wait(backoff);
    }

    let status = 'error';
    try {
      // Step 1: Fetch user card
      let card;
      try {
        card = await fetchUserCard(uidStr);
      } catch (e) {
        status = 'no_user';
        progress.stats.errors++;
        progress.processed[uidStr] = status;
        batchCount++;
        await wait(DELAY_BETWEEN_REQUESTS_MS);
        continue;
      }

      if (!card || !card.name) {
        status = 'no_user';
        progress.processed[uidStr] = status;
        batchCount++;
        await wait(DELAY_BETWEEN_REQUESTS_MS);
        continue;
      }

      await wait(DELAY_BETWEEN_REQUESTS_MS);

      // Step 2: Fetch user's videos
      let videos;
      try {
        videos = await fetchUserVideos(uidStr);
        consecutiveBlocks = 0;
      } catch (e) {
        if (e.blocked) {
          consecutiveBlocks++;
          progress.stats.blocked++;
          status = 'blocked';
          progress.processed[uidStr] = status;
          batchCount++;
          await wait(BLOCK_BACKOFF_MS);
          continue;
        }
        videos = [];
      }

      if (videos.length === 0) {
        status = 'no_videos';
        progress.stats.noVideos++;
        progress.processed[uidStr] = status;
        batchCount++;
        await wait(DELAY_BETWEEN_REQUESTS_MS);
        continue;
      }

      await wait(DELAY_BETWEEN_REQUESTS_MS);

      // Step 3: Fetch comments from user's videos
      const allComments = [];
      for (const video of videos) {
        const comments = await fetchVideoComments(video);
        allComments.push(...comments);
        await wait(DELAY_BETWEEN_REQUESTS_MS);
      }

      const commentText = allComments.map(c => c.message).filter(Boolean).join('\n');

      if (commentText.trim().length > 10) {
        // Save to user DB
        userDb.users[uidStr] = {
          uid: uidStr,
          uname: card.name,
          commentCount: allComments.length,
          commentText: commentText.slice(0, 5000),
          bvids: [...new Set(allComments.map(c => c.bvid).filter(Boolean))],
          scrapedAt: new Date().toISOString(),
        };

        // Train dictionary
        await trainWithRetry({
          text: commentText,
          uid: uidStr,
          source: `UID ${uidStr} (${card.name}) - ${allComments.length} comments from ${videos.length} videos`,
        }, { existingTermsOnly: false });

        status = 'success';
        progress.stats.success++;
      } else {
        status = 'no_comments';
        progress.stats.noComments++;
      }

    } catch (e) {
      status = 'error';
      progress.stats.errors++;
    }

    progress.processed[uidStr] = status;
    batchCount++;

    if (batchCount % SAVE_EVERY === 0) {
      const done = Object.keys(progress.processed).length;
      console.log(`  ${done}/${total} (S:${progress.stats.success} NC:${progress.stats.noComments} NV:${progress.stats.noVideos} B:${progress.stats.blocked} E:${progress.stats.errors})`);
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
      await saveJson(USER_DB_PATH, userDb);
    }

    await wait(DELAY_BETWEEN_UIDS_MS);
  }

  // Final save
  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  await saveJson(USER_DB_PATH, userDb);

  const done = Object.keys(progress.processed).length;
  console.log('\n=== DONE ===');
  console.log(`Range: ${START}-${END}`);
  console.log(`Processed: ${done}/${total}`);
  console.log(`Success: ${progress.stats.success}`);
  console.log(`No comments: ${progress.stats.noComments}`);
  console.log(`No videos: ${progress.stats.noVideos}`);
  console.log(`Blocked: ${progress.stats.blocked}`);
  console.log(`Errors: ${progress.stats.errors}`);

  try {
    const dict = await readKeywordDictionary();
    console.log(`Dictionary: ${dict.entries.length} entries`);
  } catch {}
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
