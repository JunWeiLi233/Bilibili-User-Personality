import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchJson, fetchRepliesForVideo, humanPause } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

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

function installLiveProcessHandlers() {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught:', err.message);
  });
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled:', err?.message || err);
  });
}

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePlanControlArgs(argv = process.argv.slice(2)) {
  let planJson = false;
  let pythonPlan = process.env.BILIBILI_UID_RANGE_SCRAPE_USE_PYTHON_PLAN === '1';
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
  let progressFile = '';
  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--start=')) start = Number(arg.slice('--start='.length)) || 1;
    else if (arg.startsWith('--end=')) end = Number(arg.slice('--end='.length)) || 100000;
    else if (arg.startsWith('--progress=')) progressFile = arg.slice('--progress='.length);
  }
  return { start, end, progressFile: progressFile || `uid-range-progress-${start}-${end}.json` };
}

export function buildUidRangeScrapePlan(payload = {}) {
  const argv = Array.isArray(payload.argv) ? payload.argv : [];
  const progress = payload && typeof payload.progress === 'object' && !Array.isArray(payload.progress) ? payload.progress : {};
  const database = payload && typeof payload.database === 'object' && !Array.isArray(payload.database) ? payload.database : {};
  const planArgs = parsePlanArgs(argv);
  const processed = progress.processed && typeof progress.processed === 'object' && !Array.isArray(progress.processed) ? progress.processed : {};
  const stats = progress.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  return {
    ok: true,
    range: {
      start: planArgs.start,
      end: planArgs.end,
      total: planArgs.end - planArgs.start + 1,
      progressFile: planArgs.progressFile,
    },
    resume: {
      processed: Object.keys(processed).length,
      userDbUsers: Object.keys(users).length,
    },
    collection: {
      videosPerUser: VIDEOS_PER_USER,
      commentPagesPerVideo: COMMENT_PAGES_PER_VIDEO,
    },
    stats: {
      success: intOrZero(stats.success),
      noComments: intOrZero(stats.noComments),
      noVideos: intOrZero(stats.noVideos),
      errors: intOrZero(stats.errors),
      blocked: intOrZero(stats.blocked),
    },
    pacing: {
      delayBetweenUidsMs: DELAY_BETWEEN_UIDS_MS,
      delayBetweenRequestsMs: DELAY_BETWEEN_REQUESTS_MS,
      saveEvery: SAVE_EVERY,
      blockBackoffMs: BLOCK_BACKOFF_MS,
    },
    training: {
      multiagent: true,
      existingTermsOnly: false,
      lockRetryDelayMs: LOCK_RETRY_DELAY_MS,
      lockMaxRetries: LOCK_MAX_RETRIES,
    },
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

async function runPythonUidRangeScrapePlan(payload) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-range-scrape-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_range_scrape_plan', '--payload', payloadPath], {
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
  const control = parsePlanControlArgs();
  if (control.planJson) {
    const payload = await readPlanPayload(control.payloadPath);
    const plan = control.pythonPlan ? await runPythonUidRangeScrapePlan(payload) : buildUidRangeScrapePlan(payload);
    console.log(JSON.stringify(plan, null, 2));
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  installLiveProcessHandlers();

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
