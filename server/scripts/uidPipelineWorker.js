import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fetchJson, fetchRepliesForVideo } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const hasFlag = (name) => process.argv.slice(2).includes(`--${name}`);

const START = Number(args.start || 1);
const END = Number(args.end || 100000);
const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, `uid-pipeline-${START}-${END}.json`);
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const VIDEOS_PER_USER = 3;
const COMMENT_PAGES_PER_VIDEO = 2;
const DELAY_UID_MS = 1500;
const DELAY_REQUEST_MS = 500;
const SAVE_EVERY = 20;
const LOCK_RETRY_DELAY_MS = 10000;
const LOCK_MAX_RETRIES = 5;
const BLOCK_BACKOFF_BASE_MS = 30000;
const execFileAsync = promisify(execFile);

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function parseNumberOr(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePlanArgs(argv = []) {
  const options = { start: 1, end: 100000 };
  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--start=')) options.start = parseNumberOr(arg.split('=', 2)[1], 1);
    else if (arg.startsWith('--end=')) options.end = parseNumberOr(arg.split('=', 2)[1], 100000);
  }
  return options;
}

function parsePlanControlArgs(argv = []) {
  let planJson = false;
  let pythonPlan = false;
  let jsPlan = false;
  let payloadPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--plan-json') {
      planJson = true;
    } else if (arg === '--python-plan') {
      pythonPlan = true;
    } else if (arg === '--js-plan') {
      jsPlan = true;
    } else if (arg === '--payload') {
      payloadPath = String(argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length);
    }
  }
  if (process.env.BILIBILI_UID_PIPELINE_WORKER_USE_PYTHON_PLAN === '1' && !jsPlan) {
    pythonPlan = true;
  }
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

async function runPythonUidPipelineWorkerPlan(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_pipeline_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function usersInRange(users = {}, start = 1, end = 100000) {
  return Object.keys(users).filter((uid) => {
    const numericUid = Number.parseInt(uid, 10);
    return Number.isFinite(numericUid) && numericUid >= start && numericUid <= end;
  }).length;
}

function buildUidPipelineWorkerPlan(payload = {}) {
  const options = parsePlanArgs(Array.isArray(payload.argv) ? payload.argv : []);
  const start = options.start;
  const end = options.end;
  const total = Math.max(0, end - start + 1);
  const progress = payload.progress && typeof payload.progress === 'object' ? payload.progress : {};
  const database = payload.database && typeof payload.database === 'object' ? payload.database : {};
  const processed = progress.processed && typeof progress.processed === 'object' ? progress.processed : {};
  const stats = progress.stats && typeof progress.stats === 'object' ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  const processedCount = Object.keys(processed).length;

  return {
    ok: true,
    range: { start, end, total },
    progress: {
      processed: processedCount,
      remaining: Math.max(0, total - processedCount),
      completionRatio: total ? Math.round((processedCount / total) * 10000) / 10000 : 0,
    },
    limits: {
      videosPerUser: VIDEOS_PER_USER,
      commentPagesPerVideo: COMMENT_PAGES_PER_VIDEO,
      commentTextMinChars: 10,
      commentTextLimit: 8000,
    },
    pacing: {
      delayUidMs: DELAY_UID_MS,
      delayRequestMs: DELAY_REQUEST_MS,
      saveEvery: SAVE_EVERY,
    },
    training: {
      multiagent: true,
      existingTermsOnly: false,
      lockRetryDelayMs: LOCK_RETRY_DELAY_MS,
      lockMaxRetries: LOCK_MAX_RETRIES,
    },
    blockPolicy: {
      blockedCodes: [-799, -352],
      consecutiveBlockThreshold: 3,
      blockBackoffBaseMs: BLOCK_BACKOFF_BASE_MS,
      blockBackoffMaxMultiplier: 10,
    },
    stats: {
      success: parseNumberOr(stats.success, 0),
      noComments: parseNumberOr(stats.noComments, 0),
      noVideos: parseNumberOr(stats.noVideos, 0),
      noUser: parseNumberOr(stats.noUser, 0),
      trainError: parseNumberOr(stats.trainError, 0),
      blocked: parseNumberOr(stats.blocked, 0),
      errors: parseNumberOr(stats.errors, 0),
    },
    userDb: { users: Object.keys(users).length, usersInRange: usersInRange(users, start, end) },
  };
}

const planControl = parsePlanControlArgs(process.argv.slice(2));
if (planControl.planJson) {
  if (planControl.pythonPlan && !planControl.jsPlan) {
    console.log(JSON.stringify(await runPythonUidPipelineWorkerPlan(planControl.payloadPath), null, 2));
    process.exit(0);
  }
  const payload = args.payload ? JSON.parse(await readFile(args.payload, 'utf8')) : {};
  console.log(JSON.stringify(buildUidPipelineWorkerPlan(payload), null, 2));
  process.exit(0);
}

process.on('uncaughtException', err => console.error('Uncaught:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled:', err?.message || err));

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
      return await trainKeywordDictionary({ ...payload, multiagent: true }, { ...options, multiagent: true });
    } catch (error) {
      if ((error.message || '').includes('lock')) {
        await wait(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Lock retry exhausted');
}

async function fetchUserCard(uid) {
  const url = `https://api.bilibili.com/x/web-interface/card?mid=${uid}`;
  const data = await fetchJson(url, 'https://www.bilibili.com');
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
  const url = `https://api.bilibili.com/x/space/arc/list?mid=${uid}&pn=1&ps=${VIDEOS_PER_USER}&order=pubdate`;
  const data = await fetchJson(url, `https://space.bilibili.com/${uid}`);
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
    sourceUrl: `https://www.bilibili.com/video/${v.bvid}/`,
  }));
}

async function processUid(uid, progress, userDb) {
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
      const scan = await fetchRepliesForVideo(video.sourceUrl || video.bvid, { pages: COMMENT_PAGES_PER_VIDEO });
      if (scan.ok && scan.comments?.length > 0) {
        allComments.push(...scan.comments);
      }
    } catch {}
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

  console.log(`UID Pipeline Worker: ${START}-${END} (${total} UIDs)`);
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
      result = await processUid(uid, progress, userDb);
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

    await wait(DELAY_UID_MS);
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
  console.error('Fatal:', err.message);
  process.exit(1);
});
