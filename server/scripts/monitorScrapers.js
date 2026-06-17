import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'server', 'data');

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function main() {
  // Discovery scraper
  const disc = await loadJson(join(DATA_DIR, 'uid-discovery-progress.json'), {});
  const discAnalyzed = disc.stats?.uidsAnalyzed || 0;
  const discFound = disc.stats?.uidsFound || 0;
  const discErrors = disc.stats?.errors || 0;

  // Pipeline workers
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalNoComments = 0;
  let totalNoVideos = 0;
  let totalNoUser = 0;
  let totalErrors = 0;

  for (const rng of ['1-20000', '20001-40000', '40001-60000', '60001-80000', '80001-100000']) {
    const p = await loadJson(join(DATA_DIR, `uid-pipeline-${rng}.json`), {});
    const proc = Object.keys(p.processed || {}).length;
    const s = p.stats || {};
    totalProcessed += proc;
    totalSuccess += s.success || 0;
    totalNoComments += s.noComments || 0;
    totalNoVideos += s.noVideos || 0;
    totalNoUser += s.noUser || 0;
    totalErrors += s.errors || 0;
  }

  const totalAnalyzed = discAnalyzed + totalSuccess;
  const pipelineRemaining = 100000 - totalProcessed;
  const discRemaining = discFound - discAnalyzed;

  console.log('=== Scraper Monitor ===');
  console.log(`Discovery: ${discAnalyzed}/${discFound} analyzed (${discRemaining} remaining, ${discErrors} errors)`);
  console.log(`Pipeline: ${totalProcessed} processed, ${totalSuccess} success (${totalNoComments} noCmt, ${totalNoVideos} noVid, ${totalNoUser} noUser, ${totalErrors} errors)`);
  console.log(`Combined: ${totalAnalyzed} UIDs analyzed`);
  console.log(`Pipeline ETA: ~${Math.ceil(pipelineRemaining / 50)} min (${(pipelineRemaining / 50 / 60).toFixed(1)} hours)`);
}

main().catch(console.error);
