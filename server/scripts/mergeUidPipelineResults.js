import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');
const TOTAL_START = 1;
const TOTAL_END = 100000;
const WORKERS = 5;
const CHUNK_SIZE = Math.ceil((TOTAL_END - TOTAL_START + 1) / WORKERS);

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const merged = {
    processed: {},
    stats: { success: 0, noComments: 0, noUser: 0, trainError: 0, blocked: 0, errors: 0 },
    lastUpdated: null,
  };

  const userDb = await loadJson(USER_DB_PATH, { users: {} });

  for (let i = 0; i < WORKERS; i++) {
    const start = TOTAL_START + i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE - 1, TOTAL_END);
    const progressPath = join(DATA_DIR, `uid-pipeline-${start}-${end}.json`);

    const progress = await loadJson(progressPath, { processed: {}, stats: {} });
    const count = Object.keys(progress.processed).length;

    if (count === 0) {
      console.log(`  ${start}-${end}: no progress`);
      continue;
    }

    // Merge processed UIDs
    Object.assign(merged.processed, progress.processed);

    // Merge stats
    for (const key of ['success', 'noComments', 'noUser', 'trainError', 'blocked', 'errors']) {
      merged.stats[key] += (progress.stats?.[key] || 0);
    }

    console.log(`  ${start}-${end}: ${count} processed (S:${progress.stats?.success || 0} NC:${progress.stats?.noComments || 0} B:${progress.stats?.blocked || 0})`);
  }

  merged.lastUpdated = new Date().toISOString();
  await saveJson(join(DATA_DIR, 'uid-pipeline-merged.json'), merged);

  const totalProcessed = Object.keys(merged.processed).length;
  console.log(`\n=== MERGED RESULTS ===`);
  console.log(`Total UIDs processed: ${totalProcessed}/${TOTAL_END - TOTAL_START + 1}`);
  console.log(`Success: ${merged.stats.success}`);
  console.log(`No comments: ${merged.stats.noComments}`);
  console.log(`No user: ${merged.stats.noUser}`);
  console.log(`Train errors: ${merged.stats.trainError}`);
  console.log(`Blocked: ${merged.stats.blocked}`);
  console.log(`Errors: ${merged.stats.errors}`);
  console.log(`Users in DB: ${Object.keys(userDb.users).length}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
