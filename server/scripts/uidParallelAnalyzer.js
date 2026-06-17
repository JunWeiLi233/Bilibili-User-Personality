import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
      return await trainKeywordDictionary(payload, options);
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
