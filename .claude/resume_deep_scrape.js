/**
 * Self-resuming deep scrape runner.
 *
 * Invoke each turn from the /goal prompt. It:
 *  1. Reads .claude/multi_round_deep_scrape_plan.md to know the target
 *  2. Checks progress files to find the active round + next uncompleted seed
 *  3. Scrapes up to BATCH_SIZE seeds (stop early on rate-limit / 412 block)
 *  4. Checkpoints after every seed
 *  5. Prints a status summary so the next turn knows where to resume
 *
 * Usage: node .claude/resume_deep_scrape.js [round] [--batch=N]
 *   round: 1, 2, or 3 (default: auto-detect from progress files)
 *   --batch=N: max seeds to scrape this turn (default: 15)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────
const TARGET_SEEDS = 196;

const ROUNDS = {
  1: {
    label: 'R1: deepen top-5 (pages=5)',
    inputFile: '.claude/top5_per_seed.json',
    outputDir: '.claude/seed_results_deep',
    progressFile: '.claude/scrape_progress_deep.json',
    pages: 5,
    danmakuCap: 1000,
    deepenMatch: true,
    deepenRootLimit: 10,
    deepenPages: 3,
    skipExistingResults: true, // skip if already in seed_results_deep/
  },
  2: {
    label: 'R2: videos 6-10 (pages=3)',
    inputSource: 'corpus', // read from bilibiliHistoryTagCorpus.json
    outputDir: '.claude/seed_results_batch2',
    progressFile: '.claude/scrape_progress_batch2.json',
    pages: 3,
    danmakuCap: 500,
    deepenMatch: false,
    videoRankStart: 6,
    videoRankEnd: 10,
    skipExistingResults: false, // dedupe against all prior result dirs
  },
  3: {
    label: 'R3: videos 11-15 (pages=2)',
    inputSource: 'corpus',
    outputDir: '.claude/seed_results_batch3',
    progressFile: '.claude/scrape_progress_batch3.json',
    pages: 2,
    danmakuCap: 300,
    deepenMatch: false,
    videoRankStart: 11,
    videoRankEnd: 15,
    skipExistingResults: false,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadJson(fp) {
  return JSON.parse(await readFile(join(PROJECT, fp), 'utf8'));
}

async function loadProgress(progressFile) {
  try {
    return JSON.parse(await readFile(join(PROJECT, progressFile), 'utf8'));
  } catch {
    return { completed: [], blocked: [], lastSeed: null, totalVideos: 0, totalComments: 0, totalDanmaku: 0 };
  }
}

async function saveProgress(progressFile, progress) {
  await writeFile(join(PROJECT, progressFile), JSON.stringify(progress, null, 2), 'utf8');
}

async function saveSeedResults(outputDir, seed, results) {
  const dir = join(PROJECT, outputDir);
  await mkdir(dir, { recursive: true });
  const safeName = seed.replace(/[<>:"/\\|?*]/g, '_');
  await writeFile(join(dir, `${safeName}.json`), JSON.stringify(results, null, 2), 'utf8');
}

async function loadCorpus() {
  return loadJson('server/data/bilibiliHistoryTagCorpus.json');
}

async function loadTop5() {
  return loadJson('.claude/top5_per_seed.json');
}

function gatherAlreadyScrapedBvids() {
  const dirs = [
    '.claude/seed_results',
    '.claude/seed_results_deep',
    '.claude/seed_results_batch2',
    '.claude/seed_results_batch3',
  ];
  const bvids = new Set();
  for (const d of dirs) {
    const full = join(PROJECT, d);
    if (!existsSync(full)) continue;
    try {
      const { readdirSync, readFileSync } = require('node:fs');
      for (const fn of readdirSync(full)) {
        if (!fn.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(full, fn), 'utf8'));
          for (const v of data.videos || []) {
            if (v.bvid) bvids.add(v.bvid);
          }
        } catch { /* skip corrupt files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }
  return bvids;
}

function pickVideosForSeed(seed, corpus, round, alreadyScraped) {
  const videos = (corpus.videos || [])
    .filter(v => v.sourceQuery === seed)
    .sort((a, b) => Number(b.replyCount || 0) - Number(a.replyCount || 0));

  const start = (round.videoRankStart || 1) - 1;
  const end = round.videoRankEnd || 5;

  const candidates = videos.slice(start, end).filter(v => !alreadyScraped.has(v.bvid));
  return candidates;
}

async function buildDeepenMatcher() {
  try {
    const dict = await loadJson('server/data/deepseekKeywordDictionary.production.json');
    const terms = (dict.terms || []).map(t => t.term || t.name || '').filter(Boolean);
    return (reply) => {
      const msg = (reply?.message || '').toLowerCase();
      return terms.some(t => msg.includes(t.toLowerCase()));
    };
  } catch {
    return null; // no dictionary available — skip deepenMatch
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse --batch=N
  let batchSize = 15;
  const batchArg = args.find(a => a.startsWith('--batch='));
  if (batchArg) batchSize = parseInt(batchArg.split('=')[1], 10) || 15;

  // Determine round: explicit arg or auto-detect
  let roundNum = null;
  const roundArg = args.find(a => /^\d+$/.test(a));
  if (roundArg) {
    roundNum = parseInt(roundArg, 10);
  } else {
    // Auto-detect: find the first round whose progress file is incomplete
    for (const rn of [1, 2, 3]) {
      const rd = ROUNDS[rn];
      if (!existsSync(join(PROJECT, rd.progressFile))) { roundNum = rn; break; }
      const p = await loadProgress(rd.progressFile);
      const done = (p.completed || []).length + (p.blocked || []).length;
      if (done < TARGET_SEEDS) { roundNum = rn; break; }
    }
    if (!roundNum) roundNum = 4; // all scrape rounds done → harvest
  }

  // Harvest (round 4) is manual — just print status
  if (roundNum === 4) {
    console.log('=== All scrape rounds complete. Run harvest manually: ===');
    console.log('node server/scripts/harvestSeedCorpusEvidence.js');
    console.log('(reads .claude/seed_results*/, merges into dictionary, updates coverage audit)');
    process.exit(0);
  }

  const round = ROUNDS[roundNum];
  if (!round) { console.error(`Unknown round: ${roundNum}`); process.exit(1); }

  // Ensure the stop-hook sentinel exists so the stop hook activates
  // during this goal session. The hook checks .claude/.goal_active and
  // blocks exit until coverage + all active tasks are complete.
  const goalFile = join(PROJECT, '.claude', '.goal_active');
  if (!existsSync(goalFile)) {
    await mkdir(dirname(goalFile), { recursive: true });
    await writeFile(goalFile, JSON.stringify({
      started: new Date().toISOString(),
      plan: '.claude/multi_round_deep_scrape_plan.md',
    }, null, 2), 'utf8');
    console.log('Created .goal_active sentinel — stop hook will guard until complete.');
  }

  console.log(`=== ${round.label} ===`);
  console.log(`Batch size: ${batchSize} seeds this turn\n`);

  // Load progress
  const progress = await loadProgress(round.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);
  console.log(`Completed: ${completed.size} | Blocked: ${blocked.size} | Remaining: ${TARGET_SEEDS - completed.size - blocked.size}`);

  // Load input data
  let seedVideos;
  if (round.inputFile) {
    seedVideos = await loadTop5(); // { seed: [videos] }
  } else if (round.inputSource === 'corpus') {
    const corpus = await loadCorpus();
    const seeds = (corpus.tags || []).filter(t => t.source === 'seed').map(t => t.name);
    const alreadyScraped = gatherAlreadyScrapedBvids();
    seedVideos = {};
    for (const seed of seeds) {
      const vids = pickVideosForSeed(seed, corpus, round, alreadyScraped);
      if (vids.length > 0) seedVideos[seed] = vids;
    }
  }

  const seeds = Object.keys(seedVideos || {}).filter(s => !completed.has(s) && !blocked.has(s));

  if (seeds.length === 0) {
    console.log('No seeds remaining for this round. Marking round complete.');
    // Ensure progress reflects all done
    progress.completed = [...completed];
    progress.blocked = [...blocked];
    await saveProgress(round.progressFile, progress);
    process.exit(0);
  }

  // Build deepen matcher for round 1
  let deepenMatch = null;
  if (round.deepenMatch) {
    deepenMatch = await buildDeepenMatcher();
    if (deepenMatch) console.log('DeepenMatch: enabled (keyword dictionary loaded)');
    else console.log('DeepenMatch: UNAVAILABLE (no dictionary found)');
  }

  // Dynamic import the crawler
  const crawler = await import('../server/services/bilibiliCrawler.js');

  let totalComments = progress.totalComments || 0;
  let totalDanmaku = progress.totalDanmaku || 0;
  let totalVideos = progress.totalVideos || 0;
  let hitRateLimit = false;

  const batch = seeds.slice(0, batchSize);

  for (let i = 0; i < batch.length; i++) {
    const seed = batch[i];
    const videos = (seedVideos[seed] || []).slice(0, 5); // max 5 per seed

    console.log(`\n[${i + 1}/${batch.length}] Seed: ${seed} (${videos.length} videos)`);

    const seedResults = { seed, scrapedAt: new Date().toISOString(), round: roundNum, videos: [] };
    let seedFailures = 0;

    for (let j = 0; j < videos.length; j++) {
      const v = videos[j];

      // Seed-level guard: if first 2 videos both fail, mark blocked
      if (j <= 1 && seedFailures >= j) {
        // still evaluating — continue
      }

      try {
        console.log(`  Video ${j + 1}/${videos.length}: ${v.bvid} (replies: ${v.replyCount || '?'})`);

        const opts = {
          pages: round.pages,
          includeDanmaku: true,
        };

        if (deepenMatch) {
          opts.deepenMatch = deepenMatch;
          opts.deepenRootLimit = round.deepenRootLimit;
          opts.deepenPages = round.deepenPages;
        }

        const result = await crawler.fetchRepliesForVideo(v.bvid, opts);

        if (result.ok) {
          const comments = result.comments || [];
          const regularComments = comments.filter(c => c.kind !== 'danmaku');
          const danmaku = comments.filter(c => c.kind === 'danmaku');
          const danmakuSlice = danmaku.slice(0, round.danmakuCap);

          seedResults.videos.push({
            bvid: v.bvid,
            title: v.title || '',
            replyCount: v.replyCount || 0,
            comments: regularComments.length,
            danmaku: danmakuSlice.length,
            commentMessages: regularComments.map(c => ({
              message: (c.message || '').slice(0, 200),
              time: c.time || c.ctime,
              likes: c.like || 0,
            })),
            danmakuMessages: danmakuSlice.map(d => ({
              message: (d.message || '').slice(0, 200),
              time: d.time || d.ctime,
            })),
          });

          totalComments += regularComments.length;
          totalDanmaku += danmakuSlice.length;
          console.log(`    -> ${regularComments.length} comments, ${danmakuSlice.length} danmaku`);
        } else {
          seedFailures++;
          console.log(`    -> FAILED: ${result.error}`);
          seedResults.videos.push({ bvid: v.bvid, error: result.error });

          // Check for rate-limit codes
          if (result.error && /-412|-509|-799/.test(String(result.error))) {
            hitRateLimit = true;
            console.log('    -> RATE LIMITED, pausing round');
            break;
          }
        }
      } catch (e) {
        seedFailures++;
        console.log(`    -> ERROR: ${e.message}`);
        seedResults.videos.push({ bvid: v.bvid, error: e.message });

        if (e.message && /-412|-509|-799/.test(e.message)) {
          hitRateLimit = true;
          console.log('    -> RATE LIMITED, pausing round');
          break;
        }
      }
    }

    // Seed-level block guard
    if (seedFailures >= 2 && seedResults.videos.filter(v => !v.error).length === 0) {
      blocked.add(seed);
      seedResults._blocked = true;
      console.log(`  -> BLOCKED: first 2 videos failed, marking seed as blocked`);
    } else {
      completed.add(seed);
    }

    totalVideos += seedResults.videos.length;

    // Checkpoint: save per-seed results + progress
    await saveSeedResults(round.outputDir, seed, seedResults);
    progress.completed = [...completed];
    progress.blocked = [...blocked];
    progress.lastSeed = seed;
    progress.totalVideos = totalVideos;
    progress.totalComments = totalComments;
    progress.totalDanmaku = totalDanmaku;
    await saveProgress(round.progressFile, progress);

    // Progress summary every 10 seeds
    if ((i + 1) % 10 === 0 || i === batch.length - 1) {
      console.log(`\n--- ${round.label}: ${completed.size}/${TARGET_SEEDS} seeds | ${totalVideos}v | ${totalComments}c | ${totalDanmaku}d ---`);
    }

    if (hitRateLimit) break;
  }

  // Final summary
  const remaining = TARGET_SEEDS - completed.size - blocked.size;
  console.log(`\n=== Turn complete: ${round.label} ===`);
  console.log(`Done: ${completed.size} | Blocked: ${blocked.size} | Remaining: ${remaining}`);
  console.log(`Videos: ${totalVideos} | Comments: ${totalComments} | Danmaku: ${totalDanmaku}`);
  if (remaining === 0) {
    console.log(`\n✓ ROUND ${roundNum} COMPLETE. Delete progress file to restart, or move to round ${roundNum + 1}.`);
  } else {
    console.log(`\n→ Next turn: re-run to continue. ${remaining} seeds left, starting from first uncompleted.`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
