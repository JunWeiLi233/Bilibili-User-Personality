import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const START = Number(args.start || 1);
const END = Number(args.end || 100000);
const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, `uid-pipeline-${START}-${END}.json`);
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const DELAY_UID_MS = 3500;
const DELAY_REQUEST_MS = 1800;
const SAVE_EVERY = 20;
const LOCK_RETRY_DELAY_MS = 5000;
const LOCK_MAX_RETRIES = 5;
const BLOCK_BACKOFF_BASE_MS = 15000;
const LOCK_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json.lock');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

process.on('uncaughtException', err => {
  console.error('=== UNCAUGHT EXCEPTION ===');
  console.error(err.stack || err.message || err);
  console.error('=========================');
});
process.on('unhandledRejection', err => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error(err?.stack || err?.message || err);
  console.error('===========================');
});
process.on('exit', code => {
  console.log(`Process exiting with code ${code}`);
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('Received SIGINT');
  process.exit(0);
});

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function directFetchJson(url, referer) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': referer || 'https://www.bilibili.com',
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function trainWithRetry(payload, options, maxRetries = 15) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await trainKeywordDictionary(payload, options);
    } catch (error) {
      if ((error.message || '').includes('lock')) {
        // Wait longer between retries, only force-clean after many attempts
        const delay = LOCK_RETRY_DELAY_MS + Math.random() * 2000;
        if (attempt > 10) {
          console.log(`  Lock held, force-cleaning & retry ${attempt}/${maxRetries}...`);
          await rm(LOCK_PATH, { recursive: true, force: true }).catch(() => {});
        }
        await wait(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Lock retries exhausted');
}

async function fetchUserCard(uid) {
  const url = `https://api.bilibili.com/x/web-interface/card?mid=${uid}`;
  const data = await directFetchJson(url, 'https://www.bilibili.com');
  if (data.code !== 0) {
    if (data.code === -799 || data.code === -352) {
      const err = new Error(`blocked code ${data.code}`);
      err.blocked = true;
      throw err;
    }
    throw new Error(`card code ${data.code}`);
  }
  return data.data?.card || null;
}

async function fetchUserVideos(uid) {
  const url = `https://api.bilibili.com/x/space/arc/list?mid=${uid}&pn=1&ps=3&order=pubdate`;
  const data = await directFetchJson(url, `https://space.bilibili.com/${uid}`);
  if (data.code !== 0) {
    if (data.code === -799 || data.code === -352) {
      const err = new Error(`blocked code ${data.code}`);
      err.blocked = true;
      throw err;
    }
    return [];
  }
  return (data.data?.archives || []).map(v => ({
    bvid: v.bvid,
    aid: v.aid,
    title: v.title || '',
  }));
}

async function fetchVideoComments(bvid, aid) {
  if (!aid) {
    try {
      const viewData = await directFetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, 'https://www.bilibili.com');
      if (viewData.code === 0) aid = viewData.data?.aid;
    } catch {}
  }
  if (!aid) return [];

  const comments = [];
  let next = 0;
  for (let page = 0; page < 2; page++) {
    const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3&next=${next}&ps=20`;
    let data;
    try {
      data = await directFetchJson(url, `https://www.bilibili.com/video/${bvid}/`);
    } catch { break; }
    if (!data || data.code !== 0) break;

    const replies = data.data?.replies || [];
    for (const reply of replies) {
      const uid = String(reply.member?.mid || '');
      const message = reply.content?.message || '';
      if (uid && uid !== '0' && message) {
        comments.push({ uid, message, uname: reply.member?.uname || '' });
      }
      for (const sub of reply.replies || []) {
        const subUid = String(sub.member?.mid || '');
        const subMsg = sub.content?.message || '';
        if (subUid && subUid !== '0' && subMsg) {
          comments.push({ uid: subUid, message: subMsg, uname: sub.member?.uname || '' });
        }
      }
    }

    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end) break;
    next = cursor.next || 0;
    if (!next) break;
    await wait(200);
  }
  return comments;
}

async function processUid(uid, userDb) {
  const uidStr = String(uid);

  // Step 1: Check if user exists
  let card;
  try {
    card = await fetchUserCard(uidStr);
  } catch (e) {
    if (e.blocked) throw e;
    return { status: 'no_user' };
  }
  if (!card || !card.name) return { status: 'no_user' };

  await wait(DELAY_REQUEST_MS);

  // Step 2: Fetch user's uploaded videos
  let videos;
  try {
    videos = await fetchUserVideos(uidStr);
  } catch (e) {
    if (e.blocked) throw e;
    videos = [];
  }

  if (videos.length === 0) return { status: 'no_videos' };

  await wait(DELAY_REQUEST_MS);

  // Step 3: Scrape comments from user's videos
  const allComments = [];
  for (const video of videos) {
    try {
      const comments = await fetchVideoComments(video.bvid, video.aid);
      allComments.push(...comments);
    } catch (e) {
      console.error(`  Error fetching comments for ${video.bvid}: ${e.message}`);
    }
    await wait(DELAY_REQUEST_MS);
  }

  const commentText = allComments.map(c => c.message).filter(Boolean).join('\n');

  if (commentText.trim().length < 10) return { status: 'no_comments' };

  // Step 4: Save to user DB
  userDb.users[uidStr] = {
    uid: uidStr,
    uname: card.name,
    commentCount: allComments.length,
    commentText: commentText.slice(0, 8000),
    scrapedAt: new Date().toISOString(),
  };

  // Step 5: Train dictionary
  try {
    await trainWithRetry({
      text: commentText,
      uid: uidStr,
      source: `UID ${uidStr} (${card.name}) - ${allComments.length} comments from ${videos.length} videos`,
    }, { existingTermsOnly: false });
  } catch (e) {
    if (e.blocked) throw e;
    console.error(`  Train error for UID ${uidStr}: ${e.message}`);
    return { status: 'train_error', comments: allComments.length };
  }

  return { status: 'success', comments: allComments.length };
}

async function main() {
  const total = END - START + 1;
  const progress = await loadJson(PROGRESS_PATH, {
    processed: {},
    stats: { success: 0, noComments: 0, noVideos: 0, noUser: 0, trainError: 0, blocked: 0, errors: 0 },
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });
  const processedCount = Object.keys(progress.processed).length;

  console.log(`UID Pipeline FAST: ${START}-${END} (${total} UIDs)`);
  console.log(`Previously processed: ${processedCount}\n`);

  try {
    const dict = await readKeywordDictionary();
    console.log(`Dictionary: ${dict.entries.length} entries\n`);
  } catch {}

  let consecutiveBlocks = 0;
  let batchCount = 0;

  for (let uid = START; uid <= END; uid++) {
    const uidStr = String(uid);
    if (progress.processed[uidStr]) continue;

    if (consecutiveBlocks >= 3) {
      const backoff = BLOCK_BACKOFF_BASE_MS * Math.min(consecutiveBlocks, 10);
      console.log(`  Backing off ${backoff / 1000}s after ${consecutiveBlocks} blocks...`);
      await wait(backoff);
    }

    let result;
    try {
      result = await processUid(uid, userDb);
      consecutiveBlocks = 0;
    } catch (e) {
      if (e.blocked) {
        consecutiveBlocks++;
        progress.stats.blocked++;
        progress.processed[uidStr] = 'blocked';
        batchCount++;
        await wait(BLOCK_BACKOFF_BASE_MS);
        continue;
      }
      result = { status: 'error' };
      progress.stats.errors++;
    }

    const status = result.status;
    progress.processed[uidStr] = status;

    if (status === 'success') progress.stats.success++;
    else if (status === 'no_comments') progress.stats.noComments++;
    else if (status === 'no_videos') progress.stats.noVideos++;
    else if (status === 'no_user') progress.stats.noUser++;
    else if (status === 'train_error') progress.stats.trainError++;
    else progress.stats.errors++;

    batchCount++;

    if (batchCount % SAVE_EVERY === 0) {
      const done = Object.keys(progress.processed).length;
      console.log(`[${new Date().toISOString()}] ${done}/${total} (S:${progress.stats.success} NC:${progress.stats.noComments} NV:${progress.stats.noVideos} NU:${progress.stats.noUser} TE:${progress.stats.trainError} B:${progress.stats.blocked} E:${progress.stats.errors})`);
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
      await saveJson(USER_DB_PATH, userDb);
    }

    // Adaptive delay: fast-fail UIDs need less cooldown
    const uidDelay = (status === 'no_user' || status === 'no_videos' || status === 'error')
      ? 1800
      : DELAY_UID_MS;
    await wait(uidDelay);
  }

  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  await saveJson(USER_DB_PATH, userDb);

  const done = Object.keys(progress.processed).length;
  console.log(`\n=== DONE ===`);
  console.log(`Range: ${START}-${END}`);
  console.log(`Processed: ${done}/${total}`);
  console.log(`Success: ${progress.stats.success}`);
  console.log(`No comments: ${progress.stats.noComments}`);
  console.log(`No videos: ${progress.stats.noVideos}`);
  console.log(`No user: ${progress.stats.noUser}`);
  console.log(`Train errors: ${progress.stats.trainError}`);
  console.log(`Blocked: ${progress.stats.blocked}`);
  console.log(`Errors: ${progress.stats.errors}`);

  try {
    const dict = await readKeywordDictionary();
    console.log(`Dictionary: ${dict.entries.length} entries`);
  } catch {}
}

main().catch(err => {
  console.error('=== FATAL ERROR ===');
  console.error(err.stack || err.message || err);
  console.error('===================');
  process.exit(1);
});
