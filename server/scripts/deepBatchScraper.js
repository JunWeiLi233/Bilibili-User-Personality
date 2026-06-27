/**
 * DEPRECATED — JS path retired 2026-06-27.
 * Replaced by python_backend/cli/deep_batch_scraper.py (npm run python:deep-batch-scraper).
 * Structural parity verified via compareMigrationContracts.js (dry-run contract).
 * Kept for reference and migration-audit traceability only.
 * Live API validation pending BILIBILI_COOKIE.
 */
/**
 * Multi-round deep batch scraper for Bilibili history seed videos.
 *
 * Launched per-round with env vars or CLI args:
 *   ROUND=1|2|3              — which round
 *   DEEP_SCRAPE_WRITE=1      — actually write (default dry-run)
 *
 * Round 1: Re-scrape top-5 videos/seed with pages=5, danmaku cap 1000, deepenMatch
 *   Input:  .claude/top5_per_seed.json
 *   Output: .claude/seed_results_deep/
 *   Progress: .claude/scrape_progress_deep.json
 *
 * Round 2: Scrape videos 6-10/seed with pages=3, danmaku cap 500
 *   Input:  server/data/bilibiliHistoryTagCorpus.json
 *   Output: .claude/seed_results_batch2/
 *   Progress: .claude/scrape_progress_batch2.json
 *
 * Round 3: Scrape videos 11-15/seed with pages=2, danmaku cap 300
 *   Input:  server/data/bilibiliHistoryTagCorpus.json
 *   Output: .claude/seed_results_batch3/
 *   Progress: .claude/scrape_progress_batch3.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ── Round configs ──────────────────────────────────────────────
const ROUND_CONFIGS = {
  1: {
    label: 'Round 1 — Deepen top-5 (pages=5, danmaku 1000, deepenMatch)',
    inputFile: '.claude/top5_per_seed.json',
    outputDir: '.claude/seed_results_deep',
    progressFile: '.claude/scrape_progress_deep.json',
    pages: 5,
    danmakuCap: 1000,
    enableDeepenMatch: true,
    deepenRootLimit: 10,
    deepenPages: 3,
  },
  2: {
    label: 'Round 2 — Videos 6-10 (pages=3, danmaku 500)',
    inputFile: 'server/data/bilibiliHistoryTagCorpus.json',
    outputDir: '.claude/seed_results_batch2',
    progressFile: '.claude/scrape_progress_batch2.json',
    pages: 3,
    danmakuCap: 500,
    enableDeepenMatch: false,
    videoRankStart: 6,
    videoRankEnd: 10,
  },
  3: {
    label: 'Round 3 — Videos 11-15 (pages=2, danmaku 300)',
    inputFile: 'server/data/bilibiliHistoryTagCorpus.json',
    outputDir: '.claude/seed_results_batch3',
    progressFile: '.claude/scrape_progress_batch3.json',
    pages: 2,
    danmakuCap: 300,
    enableDeepenMatch: false,
    videoRankStart: 11,
    videoRankEnd: 15,
  },
};

// ── Helpers ────────────────────────────────────────────────────
async function loadJson(relativePath) {
  return JSON.parse(await readFile(join(PROJECT_ROOT, relativePath), 'utf8'));
}

async function loadProgress(progressFile) {
  try {
    return JSON.parse(await readFile(join(PROJECT_ROOT, progressFile), 'utf8'));
  } catch {
    return { completed: [], blocked: [], lastSeed: null, totalVideos: 0, totalComments: 0, totalDanmaku: 0 };
  }
}

async function saveProgress(progressFile, progress) {
  await writeFile(join(PROJECT_ROOT, progressFile), JSON.stringify(progress, null, 2), 'utf8');
}

async function saveSeedResults(outputDir, seed, results) {
  const dir = join(PROJECT_ROOT, outputDir);
  await mkdir(dir, { recursive: true });
  const safeName = seed.replace(/[<>:"/\\|?*]/g, '_');
  await writeFile(join(dir, `${safeName}.json`), JSON.stringify(results, null, 2), 'utf8');
}

// For R2/R3: select videos ranked N-M per seed from the history tag corpus
function selectVideosByRank(corpus, start, end, existingBvids) {
  const bySeed = {};
  for (const video of corpus.videos || []) {
    const seed = video.sourceQuery || video.tags?.[0];
    if (!seed) continue;
    if (!bySeed[seed]) bySeed[seed] = [];
    bySeed[seed].push(video);
  }
  const selected = {};
  for (const [seed, videos] of Object.entries(bySeed)) {
    const ranked = videos
      .filter(v => v.bvid && !existingBvids.has(v.bvid))
      .sort((a, b) => (Number(b.replyCount) || 0) - (Number(a.replyCount) || 0));
    const slice = ranked.slice(start - 1, end);
    if (slice.length > 0) selected[seed] = slice;
  }
  return selected;
}

// Collect all already-scraped BVIDs from existing result directories
async function collectExistingBvids(dirs) {
  const bvids = new Set();
  for (const dir of dirs) {
    try {
      const { readdir: rd } = await import('node:fs/promises');
      const files = await rd(join(PROJECT_ROOT, dir)).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await readFile(join(PROJECT_ROOT, dir, f), 'utf8'));
          for (const v of data.videos || []) {
            if (v.bvid && !v.error) bvids.add(v.bvid);
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* dir doesn't exist yet */ }
  }
  return bvids;
}

// ── Main scraper ───────────────────────────────────────────────
async function runRound(config, writeMode) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(config.label);
  console.log(`${'='.repeat(60)}\n`);

  // Load keyword dictionary for deepenMatch
  let dictTerms = [];
  if (config.enableDeepenMatch) {
    const { readKeywordDictionary } = await import('../services/deepseekKeywordTrainer.js');
    const dict = await readKeywordDictionary();
    dictTerms = (dict.entries || []).map(e => e.term).filter(Boolean);
    console.log(`Deepen match: ${dictTerms.length} dictionary terms loaded`);
  }

  // Load input data
  let targetVideos;
  if (config.videoRankStart) {
    // R2/R3: select from corpus
    console.log(`Loading corpus: ${config.inputFile}`);
    const corpus = await loadJson(config.inputFile);
    const existingBvids = await collectExistingBvids([
      '.claude/seed_results',
      '.claude/seed_results_deep',
      '.claude/seed_results_batch2',
      '.claude/seed_results_batch3',
    ]);
    console.log(`  ${existingBvids.size} already-scraped BVIDs excluded`);
    targetVideos = selectVideosByRank(corpus, config.videoRankStart, config.videoRankEnd, existingBvids);
  } else {
    // R1: top5_per_seed
    console.log(`Loading top-5: ${config.inputFile}`);
    const top5 = await loadJson(config.inputFile);
    targetVideos = top5;
  }

  const seeds = Object.keys(targetVideos);
  console.log(`Seeds: ${seeds.length}`);

  // Load progress for resume
  const progress = await loadProgress(config.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);
  console.log(`Previously completed: ${completed.size}, blocked: ${blocked.size}`);

  let totalVideos = progress.totalVideos || 0;
  let totalComments = progress.totalComments || 0;
  let totalDanmaku = progress.totalDanmaku || 0;

  const remaining = seeds.filter(s => !completed.has(s) && !blocked.has(s));
  console.log(`Remaining: ${remaining.length} seeds\n`);

  if (!writeMode) {
    console.log('DRY RUN — set DEEP_SCRAPE_WRITE=1 to actually scrape.');
    console.log(`Would process ${remaining.length} seeds.\n`);
    // Print sample
    for (const seed of remaining.slice(0, 5)) {
      const videos = targetVideos[seed] || [];
      console.log(`  ${seed}: ${videos.length} videos`);
    }
    if (remaining.length > 5) console.log(`  ... and ${remaining.length - 5} more seeds`);
    return;
  }

  // Dynamic import crawler
  const crawler = await import('../services/bilibiliCrawler.js');

  // ── Process seeds ──────────────────────────────────────────
  for (let i = 0; i < remaining.length; i++) {
    const seed = remaining[i];
    const videos = targetVideos[seed] || [];

    console.log(`[${i + 1}/${remaining.length}] Seed: ${seed} (${videos.length} videos)`);

    const seedResults = { seed, scrapedAt: new Date().toISOString(), round: config.label, videos: [] };
    let seedFailures = 0;

    for (let j = 0; j < videos.length; j++) {
      const v = videos[j];
      const videoLabel = `  Video ${j + 1}/${videos.length}: ${v.bvid}`;
      try {
        const fetchOpts = {
          pages: config.pages,
          includeDanmaku: true,
        };

        if (config.enableDeepenMatch) {
          fetchOpts.deepenMatch = (reply) => {
            const msg = String(reply?.content?.message || reply?.message || '').toLowerCase();
            return msg.length >= 4 && dictTerms.some(t => msg.includes(t.toLowerCase()));
          };
          fetchOpts.deepenRootLimit = config.deepenRootLimit || 10;
          fetchOpts.deepenPages = config.deepenPages || 3;
        }

        const result = await crawler.fetchRepliesForVideo(v.bvid, fetchOpts);

        if (result.ok) {
          const allComments = result.comments || [];
          const regularComments = allComments.filter(c => c.kind !== 'danmaku' && c.kind !== 'dm');
          const danmaku = allComments.filter(c => c.kind === 'danmaku' || c.kind === 'dm');

          seedResults.videos.push({
            bvid: v.bvid,
            title: v.title || result.video?.title || '',
            replyCount: v.replyCount || 0,
            comments: regularComments.length,
            danmaku: Math.min(danmaku.length, config.danmakuCap),
            commentMessages: regularComments.map(c => ({
              message: String(c.message || '').slice(0, 300),
              time: c.time || c.ctime || 0,
              likes: Number(c.like || 0),
            })),
            danmakuMessages: danmaku.slice(0, config.danmakuCap).map(d => ({
              message: String(d.message || d.content || '').slice(0, 200),
              time: d.time || d.ctime || 0,
            })),
          });

          totalComments += regularComments.length;
          totalDanmaku += Math.min(danmaku.length, config.danmakuCap);
          console.log(`${videoLabel} -> ${regularComments.length} comments, ${Math.min(danmaku.length, config.danmakuCap)} danmaku`);
        } else {
          console.log(`${videoLabel} -> FAILED: ${result.error}`);
          seedResults.videos.push({ bvid: v.bvid, error: result.error });
          seedFailures++;
        }
      } catch (e) {
        console.log(`${videoLabel} -> ERROR: ${e.message}`);
        seedResults.videos.push({ bvid: v.bvid, error: e.message });
        seedFailures++;
      }

      // Seed-level guard: if first 2 videos both fail, mark seed as blocked
      if (j === 1 && seedFailures >= 2) {
        console.log(`  ⚠ Seed ${seed} BLOCKED (first 2 videos failed)`);
        blocked.add(seed);
        break;
      }
    }

    totalVideos += videos.length;

    // Save per-seed results
    if (writeMode) {
      await saveSeedResults(config.outputDir, seed, seedResults);
    }

    // Update progress
    if (!blocked.has(seed)) completed.add(seed);
    progress.completed = [...completed];
    progress.blocked = [...blocked];
    progress.lastSeed = seed;
    progress.totalVideos = totalVideos;
    progress.totalComments = totalComments;
    progress.totalDanmaku = totalDanmaku;
    await saveProgress(config.progressFile, progress);

    // Summary every 10 seeds
    if ((i + 1) % 10 === 0) {
      console.log(`\n--- Progress: ${completed.size}/${seeds.length} seeds | ${totalVideos} videos | ${totalComments} comments | ${totalDanmaku} danmaku ---\n`);
    }
  }

  console.log(`\n=== ${config.label} DONE ===`);
  console.log(`Seeds: ${completed.size}/${seeds.length} (${blocked.size} blocked)`);
  console.log(`Videos: ${totalVideos}`);
  console.log(`Comments: ${totalComments}`);
  console.log(`Danmaku: ${totalDanmaku}\n`);
}

// ── CLI ────────────────────────────────────────────────────────
const round = Number(process.env.DEEP_SCRAPE_ROUND || process.argv[2]) || 1;
const writeMode = process.env.DEEP_SCRAPE_WRITE === '1';
const config = ROUND_CONFIGS[round];

if (!config) {
  console.error(`Invalid round: ${round}. Use 1, 2, or 3.`);
  process.exit(1);
}

runRound(config, writeMode).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
