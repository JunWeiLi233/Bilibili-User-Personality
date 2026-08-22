import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchJson, fetchRepliesForVideo } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const START = Number(args.start || 1);
const END = Number(args.end || 100000);
const CONCURRENCY = Number(args.concurrency || 5);
const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, `uid-pipeline-${START}-${END}.json`);
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const VIDEOS_PER_USER = 3;
const COMMENT_PAGES_PER_VIDEO = 2;
const DELAY_UID_MS = 1200;
const DELAY_REQUEST_MS = 400;
const SAVE_EVERY = 20;
const LOCK_RETRY_DELAY_MS = 8000;
const LOCK_MAX_RETRIES = 3;
const BLOCK_BACKOFF_BASE_MS = 20000;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function installLiveProcessHandlers() {
  process.on('uncaughtException', err => console.error('Uncaught:', err.message));
  process.on('unhandledRejection', err => console.error('Unhandled:', err?.message || err));
}

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePlanControlArgs(argv = process.argv.slice(2)) {
  let planJson = false;
  let pythonPlan = process.env.BILIBILI_UID_FAST_WORKER_USE_PYTHON_PLAN === '1';
  let jsPlan = false;
  let payloadPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--plan-json' || arg === '--dry-run-plan-json') {
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
  if (jsPlan) pythonPlan = false;
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

function parsePlanArgs(argv = []) {
  let start = 1;
  let end = 100000;
  let concurrency = 5;
  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--start=')) start = Number(arg.slice('--start='.length)) || 1;
    else if (arg.startsWith('--end=')) end = Number(arg.slice('--end='.length)) || 100000;
    else if (arg.startsWith('--concurrency=')) concurrency = Number(arg.slice('--concurrency='.length)) || 5;
  }
  return { start, end, concurrency };
}

export function buildUidFastPipelineWorkerPlan(payload = {}) {
  const argv = Array.isArray(payload.argv) ? payload.argv : [];
  const progress = payload && typeof payload.progress === 'object' && !Array.isArray(payload.progress) ? payload.progress : {};
  const database = payload && typeof payload.database === 'object' && !Array.isArray(payload.database) ? payload.database : {};
  const options = parsePlanArgs(argv);
  const total = Math.max(0, options.end - options.start + 1);
  const processed = progress.processed && typeof progress.processed === 'object' && !Array.isArray(progress.processed) ? progress.processed : {};
  const stats = progress.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  const processedCount = Object.keys(processed).length;
  const usersInRange = Object.keys(users).filter((uid) => {
    const numeric = Number.parseInt(uid, 10);
    return Number.isFinite(numeric) && numeric >= options.start && numeric <= options.end;
  }).length;
  return {
    ok: true,
    range: { start: options.start, end: options.end, total, concurrency: options.concurrency },
    progress: {
      processed: processedCount,
      remaining: Math.max(0, total - processedCount),
      completionRatio: total ? Number((processedCount / total).toFixed(4)) : 0,
    },
    limits: {
      videosPerUser: VIDEOS_PER_USER,
      commentPagesPerVideo: COMMENT_PAGES_PER_VIDEO,
      commentTextMinChars: 10,
      commentTextLimit: 8000,
    },
    network: { mode: 'crawlerFetchJson', usesCrawlerRateLimiter: true, usesWorkerLock: true },
    pacing: { delayUidMs: DELAY_UID_MS, delayRequestMs: DELAY_REQUEST_MS, saveEvery: SAVE_EVERY },
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
    },
    stats: {
      success: intOrZero(stats.success),
      noComments: intOrZero(stats.noComments),
      noVideos: intOrZero(stats.noVideos),
      noUser: intOrZero(stats.noUser),
      trainError: intOrZero(stats.trainError),
      blocked: intOrZero(stats.blocked),
      errors: intOrZero(stats.errors),
    },
    userDb: { users: Object.keys(users).length, usersInRange },
  };
}

async function readPlanPayload(payloadPath) {
  if (!payloadPath) {
    return {
      argv: process.argv.slice(2),
      progress: await loadJson(PROGRESS_PATH, {}),
      database: await loadJson(USER_DB_PATH, {}),
    };
  }
  return loadJson(payloadPath, {});
}

async function runPythonUidFastWorkerPlan(payload) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-fast-worker-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_fast_pipeline_worker_plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

  let card;
  try {
    card = await fetchUserCard(uidStr);
  } catch (e) {
    if (e.blocked) throw e;
    return { status: 'no_user' };
  }
  if (!card || !card.name) return { status: 'no_user' };

  await wait(DELAY_REQUEST_MS);

  let videos;
  try {
    videos = await fetchUserVideos(uidStr);
  } catch (e) {
    if (e.blocked) throw e;
    videos = [];
  }

  if (videos.length === 0) return { status: 'no_videos' };

  await wait(DELAY_REQUEST_MS);

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

  userDb.users[uidStr] = {
    uid: uidStr,
    uname: card.name,
    commentCount: allComments.length,
    commentText: commentText.slice(0, 8000),
    scrapedAt: new Date().toISOString(),
  };

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

function getNextUid(progress) {
  for (let uid = START; uid <= END; uid++) {
    if (!progress.processed[String(uid)]) return uid;
  }
  return null;
}

async function main() {
  const control = parsePlanControlArgs();
  if (control.planJson) {
    const payload = await readPlanPayload(control.payloadPath);
    const plan = control.pythonPlan ? await runPythonUidFastWorkerPlan(payload) : buildUidFastPipelineWorkerPlan(payload);
    console.log(JSON.stringify(plan, null, 2));
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  installLiveProcessHandlers();

  const total = END - START + 1;
  const progress = await loadJson(PROGRESS_PATH, {
    processed: {},
    stats: { success: 0, noComments: 0, noVideos: 0, noUser: 0, trainError: 0, blocked: 0, errors: 0 },
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });
  const processedCount = Object.keys(progress.processed).length;

  console.log(`UID Pipeline FAST Worker: ${START}-${END} (${total} UIDs, concurrency=${CONCURRENCY})`);
  console.log(`Previously processed: ${processedCount}\n`);

  try {
    const dict = await readKeywordDictionary();
    console.log(`Dictionary: ${dict.entries.length} entries\n`);
  } catch {}

  let consecutiveBlocks = 0;
  let batchCount = 0;
  const lock = {};

  async function workerLoop() {
    while (true) {
      const uid = getNextUid(progress);
      if (uid === null) break;

      const uidStr = String(uid);
      if (lock[uidStr]) { await wait(100); continue; }
      lock[uidStr] = true;

      if (consecutiveBlocks >= 3) {
        const backoff = BLOCK_BACKOFF_BASE_MS * Math.min(consecutiveBlocks, 10);
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
          delete lock[uidStr];
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
      delete lock[uidStr];
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(workerLoop());
  }
  await Promise.all(workers);

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
