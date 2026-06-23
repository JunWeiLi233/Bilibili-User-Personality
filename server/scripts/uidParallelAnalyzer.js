import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const hasFlag = (name) => process.argv.slice(2).includes(`--${name}`);

const WORKER_ID = Number(args.worker || 0);
const TOTAL_WORKERS = Number(args.workers || 4);

const DATA_DIR = join(process.cwd(), 'server', 'data');
const UID_COMMENTS_PATH = join(DATA_DIR, 'uid-discovery-comments.json');
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');
const PROGRESS_PATH = join(DATA_DIR, `uid-parallel-${WORKER_ID}-progress.json`);
const LOCK_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json.lock');
const LOCK_RETRY_DELAY_MS = 3000;
const LOCK_MAX_RETRIES = 15;
const SAVE_EVERY = 20;
const execFileAsync = promisify(execFile);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function parseNumberOr(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePlanArgs(argv = []) {
  const options = { worker: 0, workers: 4 };
  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--worker=')) options.worker = parseNumberOr(arg.split('=', 2)[1], 0);
    else if (arg.startsWith('--workers=')) options.workers = parseNumberOr(arg.split('=', 2)[1], 4);
  }
  options.workers = Math.max(1, options.workers);
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
  if (process.env.BILIBILI_UID_PARALLEL_USE_PYTHON_PLAN === '1' && !jsPlan) {
    pythonPlan = true;
  }
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

async function runPythonUidParallelPlan(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_parallel_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function commentText(entries) {
  if (!Array.isArray(entries)) return '';
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => String(entry.message || ''))
    .join('\n');
}

function buildUidParallelPlan(payload = {}) {
  const options = parsePlanArgs(Array.isArray(payload.argv) ? payload.argv : []);
  const comments = payload.comments && typeof payload.comments === 'object' ? payload.comments : {};
  const progress = payload.progress && typeof payload.progress === 'object' ? payload.progress : {};
  const database = payload.database && typeof payload.database === 'object' ? payload.database : {};
  const processed = progress.processed && typeof progress.processed === 'object' ? progress.processed : {};
  const stats = progress.stats && typeof progress.stats === 'object' ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  const assignedUids = Object.keys(comments).filter((_, index) => index % options.workers === options.worker);
  const pendingUids = assignedUids.filter((uid) => !(uid in processed));
  const skippableNoText = pendingUids.filter((uid) => !commentText(comments[uid]).trim()).length;
  const assignedSet = new Set(assignedUids);

  return {
    ok: true,
    worker: { id: options.worker, totalWorkers: options.workers, assigned: assignedUids.length },
    assignment: {
      assignedUids,
      alreadyProcessed: assignedUids.filter((uid) => uid in processed).length,
      pending: pendingUids.length,
      trainable: pendingUids.length - skippableNoText,
      skippableNoText,
    },
    training: { multiagent: true, existingTermsOnly: false, commentTextLimit: 5000, saveEvery: SAVE_EVERY },
    pacing: {
      lockRetryDelayMs: LOCK_RETRY_DELAY_MS,
      lockRetryJitterMs: 2000,
      lockMaxRetries: LOCK_MAX_RETRIES,
      staleLockRemovalAfterAttempt: 8,
    },
    stats: {
      success: parseNumberOr(stats.success, 0),
      noText: parseNumberOr(stats.noText, 0),
      errors: parseNumberOr(stats.errors, 0),
    },
    userDb: {
      users: Object.keys(users).length,
      assignedUsersInDb: Object.keys(users).filter((uid) => assignedSet.has(uid)).length,
    },
  };
}

const planControl = parsePlanControlArgs(process.argv.slice(2));
if (planControl.planJson) {
  if (planControl.pythonPlan && !planControl.jsPlan) {
    console.log(JSON.stringify(await runPythonUidParallelPlan(planControl.payloadPath), null, 2));
    process.exit(0);
  }
  const payload = args.payload ? JSON.parse(await readFile(args.payload, 'utf8')) : {};
  console.log(JSON.stringify(buildUidParallelPlan(payload), null, 2));
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error(`[W${WORKER_ID}] Uncaught:`, err.stack || err.message || err);
});
process.on('unhandledRejection', (err) => {
  console.error(`[W${WORKER_ID}] Unhandled:`, err?.stack || err?.message || err);
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
      return await trainKeywordDictionary({ ...payload, multiagent: true }, { ...options, multiagent: true });
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('lock') || msg.includes('EPERM') || msg.includes('EBUSY')) {
        if (attempt > 8) {
          await rm(LOCK_PATH, { recursive: true, force: true }).catch(() => {});
        }
        await wait(LOCK_RETRY_DELAY_MS * attempt + Math.random() * 2000);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Lock retries exhausted');
}

async function main() {
  // Load all UIDs from comments file
  const allComments = await loadJson(UID_COMMENTS_PATH, {});
  const allUids = Object.keys(allComments);
  console.log(`[W${WORKER_ID}] Total UIDs in comments file: ${allUids.length}`);

  // Assign UIDs to this worker using modular distribution
  const myUids = allUids.filter((_, i) => i % TOTAL_WORKERS === WORKER_ID);
  console.log(`[W${WORKER_ID}] Assigned ${myUids.length} UIDs (worker ${WORKER_ID}/${TOTAL_WORKERS})`);

  // Load progress
  const progress = await loadJson(PROGRESS_PATH, {
    processed: {},
    stats: { success: 0, noText: 0, errors: 0 },
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });
  const alreadyDone = Object.keys(progress.processed).length;
  console.log(`[W${WORKER_ID}] Previously processed: ${alreadyDone}`);

  let batchCount = 0;

  for (const uid of myUids) {
    if (progress.processed[uid]) continue;

    const comments = allComments[uid];
    if (!comments || !Array.isArray(comments) || comments.length === 0) {
      progress.processed[uid] = 'no_comments';
      progress.stats.noText++;
      batchCount++;
      continue;
    }

    const commentText = comments.map(c => c.message || '').filter(Boolean).join('\n');
    if (!commentText.trim()) {
      progress.processed[uid] = 'no_text';
      progress.stats.noText++;
      batchCount++;
      continue;
    }

    userDb.users[uid] = {
      uid,
      uname: comments[0]?.uname || '',
      commentCount: comments.length,
      commentText: commentText.slice(0, 5000),
      bvids: [...new Set(comments.map(c => c.bvid).filter(Boolean))],
      scrapedAt: new Date().toISOString(),
    };

    try {
      await trainWithRetry({
        text: commentText,
        uid,
        source: `UID ${uid} (${comments[0]?.uname || ''}) - ${comments.length} comments`,
      }, { existingTermsOnly: false });

      progress.processed[uid] = 'success';
      progress.stats.success++;
    } catch (e) {
      progress.processed[uid] = 'error';
      progress.stats.errors++;
      console.error(`[W${WORKER_ID}] Error UID ${uid}: ${e.message}`);
    }

    batchCount++;

    if (batchCount % SAVE_EVERY === 0) {
      const done = Object.keys(progress.processed).length;
      console.log(`[W${WORKER_ID}] ${done}/${myUids.length} (S:${progress.stats.success} NT:${progress.stats.noText} E:${progress.stats.errors})`);
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
      await saveJson(USER_DB_PATH, userDb);
    }
  }

  // Final save
  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  await saveJson(USER_DB_PATH, userDb);

  const done = Object.keys(progress.processed).length;
  console.log(`[W${WORKER_ID}] DONE: ${done}/${myUids.length} (S:${progress.stats.success} NT:${progress.stats.noText} E:${progress.stats.errors})`);
}

main().catch(err => {
  console.error(`[W${WORKER_ID}] FATAL:`, err.message);
  process.exit(1);
});
