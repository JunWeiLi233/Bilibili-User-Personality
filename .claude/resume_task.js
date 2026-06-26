/**
 * Generic task runner — replaces resume_deep_scrape.js.
 *
 * Reads a task config from .claude/tasks/<name>.json, detects task type,
 * dispatches to the appropriate handler, checkpoints per item.
 *
 * Usage:
 *   node .claude/resume_task.js <task-name> [--batch=N] [--round=R]
 *   node .claude/resume_task.js deep-scrape --batch=10
 *   node .claude/resume_task.js tieba-scrape
 *   node .claude/resume_task.js              # auto-picks first active task
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..');
const TASKS_DIR = join(__dirname, 'tasks');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadJson(fp) {
  return JSON.parse(await readFile(fp, 'utf8'));
}

function loadJsonSync(fp) {
  return JSON.parse(readFileSync(fp, 'utf8'));
}

async function loadProgress(progressFile) {
  try {
    return JSON.parse(await readFile(join(PROJECT, progressFile), 'utf8'));
  } catch {
    return { completed: [], blocked: [], lastItem: null, stats: {} };
  }
}

async function saveProgress(progressFile, progress) {
  await writeFile(join(PROJECT, progressFile), JSON.stringify(progress, null, 2), 'utf8');
}

async function saveItemResults(outputDir, key, results) {
  const dir = join(PROJECT, outputDir);
  await mkdir(dir, { recursive: true });
  const safeName = String(key).replace(/[<>:"/\\|?*]/g, '_');
  await writeFile(join(dir, `${safeName}.json`), JSON.stringify(results, null, 2), 'utf8');
}

function parseArgs(argv) {
  const args = { taskName: null, batchSize: null, round: null };
  for (const a of argv) {
    if (a.startsWith('--batch=')) args.batchSize = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--round=')) args.round = parseInt(a.split('=')[1], 10);
    else if (!a.startsWith('--')) args.taskName = a;
  }
  return args;
}

function gatherBvidsFromDirs(dirs) {
  const bvids = new Set();
  for (const d of dirs) {
    const full = join(PROJECT, d);
    if (!existsSync(full)) continue;
    try {
      for (const fn of readdirSync(full)) {
        if (!fn.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(full, fn), 'utf8'));
          for (const v of data.videos || []) {
            if (v.bvid) bvids.add(v.bvid);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return bvids;
}

// ── Task discovery ───────────────────────────────────────────────────────────

async function listActiveTasks() {
  const tasks = [];
  try {
    for (const fn of await readdir(TASKS_DIR)) {
      if (!fn.endsWith('.json')) continue;
      try {
        const cfg = await loadJson(join(TASKS_DIR, fn));
        if (cfg.type && cfg.active !== false) tasks.push({ file: fn, ...cfg });
      } catch { /* skip */ }
    }
  } catch { /* no tasks dir */ }
  return tasks;
}

// ── Handler: bilibili-seed-scrape ────────────────────────────────────────────

async function runSeedScrapeTask(cfg, batchSize, forceRound) {
  const progress = await loadProgress(cfg.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);

  // Determine active round
  let activeRound = null;
  for (const rd of cfg.rounds || []) {
    if (rd.type === 'harvest') continue; // harvest is manual
    if (forceRound && rd.id !== forceRound) continue;
    const roundKey = `round_${rd.id}_done`;
    if (progress[roundKey]) continue; // round already marked complete
    activeRound = rd;
    break;
  }

  if (!activeRound) {
    // Check if harvest is pending
    const harvestRound = (cfg.rounds || []).find(r => r.type === 'harvest');
    if (harvestRound && !progress.harvest_done) {
      console.log('All scrape rounds complete. Harvest pending — run manually:');
      console.log(`  HARVEST_WRITE=1 node server/scripts/harvestAllSeedCorpus.js`);
      console.log(`  (source dirs: ${(harvestRound.sourceDirs || []).join(', ')})`);
    } else {
      console.log('All rounds + harvest complete.');
    }
    return;
  }

  console.log(`=== ${cfg.description} ===`);
  console.log(`Active: ${activeRound.label}`);
  console.log(`Progress: ${completed.size}/${cfg.totalItems} done, ${blocked.size} blocked`);

  // Get seeds for this round
  let seedVideos;
  if (activeRound.videoSource?.type === 'file') {
    seedVideos = await loadJson(join(PROJECT, activeRound.videoSource.path));
  } else if (activeRound.videoSource?.type === 'corpus') {
    const corpus = await loadJson(join(PROJECT, 'server/data/bilibiliHistoryTagCorpus.json'));
    const alreadyScraped = gatherBvidsFromDirs([
      '.claude/seed_results', '.claude/seed_results_deep',
      '.claude/seed_results_batch2', '.claude/seed_results_batch3',
    ]);
    const seeds = (corpus.tags || []).filter(t => t.source === 'seed').map(t => t.name);
    const rStart = (activeRound.videoSource.rankStart || 1) - 1;
    const rEnd = activeRound.videoSource.rankEnd || 5;
    seedVideos = {};
    for (const seed of seeds) {
      const vids = (corpus.videos || [])
        .filter(v => v.sourceQuery === seed)
        .sort((a, b) => Number(b.replyCount || 0) - Number(a.replyCount || 0))
        .slice(rStart, rEnd)
        .filter(v => !alreadyScraped.has(v.bvid));
      if (vids.length > 0) seedVideos[seed] = vids;
    }
  } else if (activeRound.videoSource?.type === 'search-api') {
    // For new-domains task — search Bilibili API for custom seeds
    const allSeeds = Object.values(cfg.seeds || {}).flat();
    const crawlerMod = await import('../server/services/bilibiliCrawler.js');
    seedVideos = {};
    // Only search up to batchSize uncompleted seeds per turn (not all)
    const searchBatch = allSeeds.filter(s => !completed.has(s) && !blocked.has(s))
      .slice(0, batchSize != null ? batchSize : (cfg.batchSize || 15));
    const searchPage = activeRound.videoSource.pages || 1;
    for (const seed of searchBatch) {
      try {
        const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(seed)}&page=${searchPage}&page_size=${activeRound.videoSource.pageSize || 20}`;
        const payload = await crawlerMod.fetchJson(url, `https://search.bilibili.com/all?keyword=${encodeURIComponent(seed)}`);
        seedVideos[seed] = (payload.data?.result || [])
          .filter(item => item?.bvid)
          .map(item => ({
            bvid: item.bvid,
            aid: item.aid || '',
            title: (item.title || '').replace(/<[^>]+>/g, ''),
            replyCount: Number(item.review || item.comment || 0),
          }));
      } catch (e) {
        console.warn(`  Search failed for seed "${seed}": ${e.message}`);
        seedVideos[seed] = [];
      }
    }
  } else if (activeRound.videoSource?.type === 'prior-round') {
    // Read videos from a prior round's output dir
    const priorDir = (cfg.rounds || []).find(r => r.id === activeRound.videoSource.roundId)?.outputDir;
    if (!priorDir) throw new Error(`Prior round ${activeRound.videoSource.roundId} not found`);
    const priorFull = join(PROJECT, priorDir);
    seedVideos = {};
    if (existsSync(priorFull)) {
      for (const fn of readdirSync(priorFull)) {
        if (!fn.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(priorFull, fn), 'utf8'));
          const seed = data.seed;
          if (!seed) continue;
          const vids = (data.videos || [])
            .filter(v => v.bvid && !v.error)
            .sort((a, b) => Number(b.replyCount || 0) - Number(a.replyCount || 0));
          const topN = activeRound.videoSource.topN || 5;
          const skipN = activeRound.videoSource.skipN || 0;
          seedVideos[seed] = vids.slice(skipN, skipN + topN);
        } catch { /* skip */ }
      }
    }
  }

  const seeds = Object.keys(seedVideos || {})
    .filter(s => !completed.has(s) && !blocked.has(s));

  if (seeds.length === 0) {
    // Guard: if seedVideos is empty AND we haven't completed all items,
    // the data source failed — don't falsely mark round done
    if (Object.keys(seedVideos || {}).length === 0) {
      const totalDone = completed.size + blocked.size;
      if (cfg.totalItems > 0 && totalDone >= cfg.totalItems) {
        // All items completed — legitimate round-done (e.g. search-api source)
        progress[`round_${activeRound.id}_done`] = true;
        await saveProgress(cfg.progressFile, progress);
        console.log(`Round ${activeRound.id} complete (all ${cfg.totalItems} items done). Re-run to start next round.`);
        return;
      }
      console.error('ERROR: No seeds loaded from video source. Check task config, data files, or prior round output.');
      console.error(`  Source type: ${activeRound.videoSource?.type}, round: ${activeRound.id}, done: ${totalDone}/${cfg.totalItems}`);
      return;
    }
    // Mark round done
    progress[`round_${activeRound.id}_done`] = true;
    await saveProgress(cfg.progressFile, progress);
    console.log(`Round ${activeRound.id} complete. Re-run to start next round.`);
    return;
  }

  // Build deepen matcher
  let deepenMatch = null;
  if (activeRound.deepenMatch) {
    try {
      const dict = await loadJson(join(PROJECT, 'server/data/deepseekKeywordDictionary.production.json'));
      const terms = (dict.terms || []).map(t => t.term || t.name || '').filter(Boolean);
      deepenMatch = (reply) => {
        const msg = (reply?.message || '').toLowerCase();
        return terms.some(t => msg.includes(t.toLowerCase()));
      };
      console.log('DeepenMatch: enabled');
    } catch { console.log('DeepenMatch: UNAVAILABLE'); }
  }

  const crawler = await import('../server/services/bilibiliCrawler.js');
  const batch = seeds.slice(0, batchSize != null ? batchSize : (cfg.batchSize || 15));
  let totalComments = progress.stats?.totalComments || 0;
  let totalDanmaku = progress.stats?.totalDanmaku || 0;
  let hitRateLimit = false;

  for (let i = 0; i < batch.length; i++) {
    const seed = batch[i];
    const videos = (seedVideos[seed] || []).slice(0, activeRound.videoCount || 5);

    console.log(`\n[${i + 1}/${batch.length}] ${seed} (${videos.length} videos)`);

    const seedResults = { seed, scrapedAt: new Date().toISOString(), round: activeRound.id, videos: [] };
    let seedFailures = 0;
    let seedBlocked = false;

    for (let j = 0; j < videos.length; j++) {
      const v = videos[j];
      try {
        console.log(`  [${j + 1}/${videos.length}] ${v.bvid} replies=${v.replyCount || '?'}`);

        if (activeRound.metadataOnly) {
          seedResults.videos.push({ bvid: v.bvid, title: v.title, replyCount: v.replyCount, _metadataOnly: true });
          continue;
        }

        const opts = { pages: activeRound.pages, includeDanmaku: activeRound.danmakuCap > 0 };
        if (deepenMatch) {
          opts.deepenMatch = deepenMatch;
          opts.deepenRootLimit = activeRound.deepenRootLimit || 10;
          opts.deepenPages = activeRound.deepenPages || 3;
        }

        const result = await crawler.fetchRepliesForVideo(v.bvid, opts);

        if (result.ok) {
          const comments = result.comments || [];
          const regular = comments.filter(c => c.kind !== 'danmaku');
          const danmaku = comments.filter(c => c.kind === 'danmaku');
          const cap = activeRound.danmakuCap || 500;

          seedResults.videos.push({
            bvid: v.bvid, title: v.title || '', replyCount: v.replyCount || 0,
            comments: regular.length, danmaku: Math.min(danmaku.length, cap),
            commentMessages: regular.map(c => ({ message: (c.message || '').slice(0, 200), time: c.time || c.ctime, likes: c.like || 0 })),
            danmakuMessages: danmaku.slice(0, cap).map(d => ({ message: (d.message || '').slice(0, 200), time: d.time || d.ctime })),
          });
          totalComments += regular.length;
          totalDanmaku += Math.min(danmaku.length, cap);
          console.log(`    -> ${regular.length}c, ${Math.min(danmaku.length, cap)}d`);
        } else {
          seedFailures++;
          seedResults.videos.push({ bvid: v.bvid, error: result.error });
          console.log(`    -> FAILED: ${result.error}`);
          if (/(-412|-509|-799)/.test(String(result.error))) { hitRateLimit = true; break; }
        }
      } catch (e) {
        seedFailures++;
        seedResults.videos.push({ bvid: v.bvid, error: e.message });
        console.log(`    -> ERROR: ${e.message}`);
        if (/(-412|-509|-799)/.test(e.message)) { hitRateLimit = true; break; }
      }
    }

    // Only mark seed complete/blocked if we didn't hit a rate limit mid-seed.
    // Rate-limited seeds stay unmarked → retried next turn with remaining videos.
    if (!hitRateLimit) {
      if (seedFailures >= 2 && seedResults.videos.filter(v => !v.error && !v._metadataOnly).length === 0) {
        blocked.add(seed);
        seedResults._blocked = true;
        console.log(`  -> BLOCKED`);
      } else {
        completed.add(seed);
      }
    } else {
      console.log(`  -> PAUSED (rate limit) — will resume next turn`);
    }

    await saveItemResults(activeRound.outputDir, seed, seedResults);
    progress.completed = [...completed];
    progress.blocked = [...blocked];
    progress.lastItem = seed;
    progress.stats = { ...(progress.stats || {}), totalComments, totalDanmaku };
    await saveProgress(cfg.progressFile, progress);

    if ((i + 1) % 10 === 0 || i === batch.length - 1) {
      const remaining = cfg.totalItems - completed.size - blocked.size;
      console.log(`\n--- ${activeRound.label}: ${completed.size}/${cfg.totalItems} seeds | ${remaining} left | ${totalComments}c ${totalDanmaku}d ---`);
    }
    if (hitRateLimit) break;
  }

  const remaining = cfg.totalItems - completed.size - blocked.size;
  console.log(`\n=== Turn complete ===`);
  console.log(`Done: ${completed.size} | Blocked: ${blocked.size} | Left: ${remaining}`);
  if (remaining === 0) {
    progress[`round_${activeRound.id}_done`] = true;
    await saveProgress(cfg.progressFile, progress);
    console.log(`Round ${activeRound.id} DONE. Next turn will advance to next round.`);
  } else {
    console.log(`→ Re-run to continue.`);
  }
}

// ── Handler: bilibili-keyword-search ────────────────────────────────────────

async function runKeywordSearchTask(cfg, batchSize) {
  const progress = await loadProgress(cfg.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);

  // Load dictionary terms
  const dict = await loadJson(join(PROJECT, 'server/data/deepseekKeywordDictionary.production.json'));
  const allTerms = (dict.terms || []).map(t => t.term || t.name || '').filter(Boolean);
  const totalItems = cfg.totalItems || allTerms.length;

  const skipFamilies = new Set(cfg.config?.skipFamilies || []);
  const terms = allTerms.filter((_, i) => {
    const family = dict.terms[i]?.family;
    return !skipFamilies.has(family);
  });

  const pending = terms.filter(t => !completed.has(t) && !blocked.has(t));
  const effectiveBatch = batchSize != null ? batchSize : (cfg.batchSize || 20);

  console.log(`=== ${cfg.description} ===`);
  console.log(`Terms: ${completed.size}/${terms.length} done, ${pending.length} remaining`);
  console.log(`Batch: ${Math.min(effectiveBatch, pending.length)} terms this turn\n`);

  if (pending.length === 0) {
    progress.keyword_search_done = true;
    await saveProgress(cfg.progressFile, progress);
    if (cfg.config?.harvestAfter) {
      console.log('All terms searched. Run harvest:');
      console.log(`  HARVEST_WRITE=1 node server/scripts/harvestSeedCorpusEvidence.js`);
    }
    return;
  }

  const crawler = await import('../server/services/bilibiliCrawler.js');
  const alreadyScraped = cfg.config?.deduplicateCorpus ? gatherBvidsFromDirs([
    '.claude/seed_results', '.claude/seed_results_deep', '.claude/seed_results_batch2',
    '.claude/seed_results_batch3', cfg.config.outputDir,
  ]) : new Set();

  const batch = pending.slice(0, effectiveBatch);
  let totalComments = progress.stats?.totalComments || 0;
  let totalDanmaku = progress.stats?.totalDanmaku || 0;
  let hitRateLimit = false;

  for (let i = 0; i < batch.length; i++) {
    const term = batch[i];
    console.log(`\n[${i + 1}/${batch.length}] Term: "${term}"`);

    const termResults = { term, scrapedAt: new Date().toISOString(), videos: [] };
    let termFailures = 0;

    try {
      // Search Bilibili
      const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(term)}&page=1&page_size=${cfg.config.searchPageSize || 10}`;
      const payload = await crawler.fetchJson(searchUrl, `https://search.bilibili.com/all?keyword=${encodeURIComponent(term)}`);
      const results = (payload.data?.result || [])
        .filter(item => item?.bvid && !alreadyScraped.has(item.bvid))
        .slice(0, cfg.config.videosPerTerm || 3);

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        try {
          console.log(`  [${j + 1}/${results.length}] ${r.bvid} "${(r.title || '').slice(0, 40)}"`);
          const opts = { pages: cfg.config.scrapePages || 3, includeDanmaku: (cfg.config.danmakuCap || 0) > 0 };
          const result = await crawler.fetchRepliesForVideo(r.bvid, opts);

          if (result.ok) {
            const comments = result.comments || [];
            const regular = comments.filter(c => c.kind !== 'danmaku');
            const danmaku = comments.filter(c => c.kind === 'danmaku');
            const cap = cfg.config.danmakuCap || 500;
            termResults.videos.push({
              bvid: r.bvid, title: r.title || '', replyCount: r.review || r.comment || 0,
              comments: regular.length, danmaku: Math.min(danmaku.length, cap),
              commentMessages: regular.map(c => ({ message: (c.message || '').slice(0, 200), time: c.time || c.ctime, likes: c.like || 0 })),
              danmakuMessages: danmaku.slice(0, cap).map(d => ({ message: (d.message || '').slice(0, 200), time: d.time || d.ctime })),
            });
            totalComments += regular.length;
            totalDanmaku += Math.min(danmaku.length, cap);
            alreadyScraped.add(r.bvid);
            console.log(`    -> ${regular.length}c, ${Math.min(danmaku.length, cap)}d`);
          } else {
            termFailures++;
            termResults.videos.push({ bvid: r.bvid, error: result.error });
            if (/(-412|-509|-799)/.test(String(result.error))) { hitRateLimit = true; break; }
          }
        } catch (e) {
          termFailures++;
          termResults.videos.push({ bvid: r.bvid, error: e.message });
          if (/(-412|-509|-799)/.test(e.message)) { hitRateLimit = true; break; }
        }
      }
    } catch (e) {
      termFailures++;
      console.log(`  Search failed: ${e.message}`);
    }

    // Only mark term complete/blocked if we didn't hit a rate limit mid-term.
    if (!hitRateLimit) {
      if (termFailures >= 2 && termResults.videos.filter(v => !v.error).length === 0) {
        blocked.add(term);
        termResults._blocked = true;
      } else {
        completed.add(term);
      }
    } else {
      console.log(`  -> PAUSED (rate limit) — will resume next turn`);
    }

    await saveItemResults(cfg.config.outputDir, term, termResults);
    progress.completed = [...completed];
    progress.blocked = [...blocked];
    progress.lastItem = term;
    progress.stats = { ...(progress.stats || {}), totalComments, totalDanmaku };
    await saveProgress(cfg.progressFile, progress);

    if ((i + 1) % 10 === 0 || i === batch.length - 1) {
      console.log(`\n--- ${completed.size}/${terms.length} terms | ${totalComments}c ${totalDanmaku}d ---`);
    }
    if (hitRateLimit) break;
  }

  const remaining = terms.length - completed.size - blocked.size;
  console.log(`\n=== Turn complete: ${completed.size}/${terms.length} done, ${remaining} left ===`);
  if (remaining === 0) {
    progress.keyword_search_done = true;
    await saveProgress(cfg.progressFile, progress);
    console.log('All terms searched. Run harvest to merge evidence.');
  }
}

// ── Handler: tieba-keyword-scrape ───────────────────────────────────────────

async function runTiebaScrapeTask(cfg, batchSize) {
  const progress = await loadProgress(cfg.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);

  console.log(`=== ${cfg.description} ===`);
  console.log(`This task wraps: npm run dictionary:tieba`);
  console.log(`\nTieba scraping uses its own CLI with built-in progress tracking.`);
  console.log(`Launch it directly:\n`);

  const tcfg = cfg.config || {};
  const cmd = [
    'node server/scripts/runTiebaKeywordScrape.js',
    `--forum-pages=${tcfg.forumPages || 2}`,
    `--thread-limit=${tcfg.threadLimit || 5}`,
    `--thread-pages=${tcfg.threadPages || 2}`,
    `--min-delay-ms=${tcfg.minDelayMs || 5000}`,
    `--jitter-ms=${tcfg.jitterMs || 3000}`,
    `--block-cooldown-ms=${tcfg.blockCooldownMs || 120000}`,
    tcfg.maxQueries ? `--max-queries=${tcfg.maxQueries}` : '',
    tcfg.discoveryMode ? `--discovery-mode=${tcfg.discoveryMode}` : '',
  ].filter(Boolean).join(' \\\n  ');

  console.log(`  ${cmd}`);
  console.log(`\nAfter scrape: HARVEST_WRITE=1 tieba corpus merge, then npm run dictionary:coverage`);
  console.log(`\nTieba scraper maintains its own progress internally.`);
  console.log(`Mark this task complete in ${cfg.progressFile} after the Tieba run finishes.`);
}

// ── Handler: bilibili-danmaku-deep ──────────────────────────────────────────

async function runDanmakuDeepTask(cfg, batchSize) {
  const progress = await loadProgress(cfg.progressFile);
  const completed = new Set(progress.completed || []);
  const blocked = new Set(progress.blocked || []);

  // Load top videos from corpus
  const corpus = await loadJson(join(PROJECT, cfg.config.videoSource.corpusPath || 'server/data/bilibiliHistoryTagCorpus.json'));
  const topVideos = (corpus.videos || [])
    .sort((a, b) => Number(b.replyCount || 0) - Number(a.replyCount || 0))
    .slice(0, cfg.config.videoSource.count || 500);

  const pending = topVideos.filter(v => !completed.has(v.bvid) && !blocked.has(v.bvid));
  const effectiveBatch = batchSize != null ? batchSize : (cfg.batchSize || 25);

  console.log(`=== ${cfg.description} ===`);
  console.log(`Videos: ${completed.size}/${topVideos.length} done, ${pending.length} remaining`);
  console.log(`Batch: ${Math.min(effectiveBatch, pending.length)} videos this turn\n`);

  if (pending.length === 0) {
    progress.danmaku_deep_done = true;
    await saveProgress(cfg.progressFile, progress);
    if (cfg.config?.harvestAfter) {
      console.log('All danmaku fetched. Run harvest with danmaku weight:');
      console.log(`  node server/scripts/harvestAllSeedCorpus.js (add ${cfg.config.outputDir} to source dirs)`);
    }
    return;
  }

  const crawler = await import('../server/services/bilibiliCrawler.js');
  const batch = pending.slice(0, effectiveBatch);
  let totalDanmaku = progress.stats?.totalDanmaku || 0;
  let hitRateLimit = false;

  for (let i = 0; i < batch.length; i++) {
    const v = batch[i];
    console.log(`\n[${i + 1}/${batch.length}] ${v.bvid} "${(v.title || '').slice(0, 50)}" replies=${v.replyCount || '?'}`);

    try {
      const video = await crawler.resolveBvid(v.bvid);
      const danmaku = await crawler.fetchDanmakuForVideo(video, {
        usePythonParser: cfg.config.usePythonParser,
      });

      const cap = cfg.config.danmakuCap || 5000;
      const sliced = danmaku.slice(0, cap);
      const result = {
        bvid: v.bvid, title: v.title, replyCount: v.replyCount,
        scrapedAt: new Date().toISOString(),
        totalDanmaku: danmaku.length,
        savedDanmaku: sliced.length,
        danmakuMessages: sliced.map(d => ({
          message: (d.message || '').slice(0, 200),
          time: d.time || d.ctime,
        })),
      };

      await saveItemResults(cfg.config.outputDir, v.bvid, result);
      totalDanmaku += sliced.length;
      completed.add(v.bvid);
      console.log(`  -> ${sliced.length} danmaku (${danmaku.length} total available)`);

    } catch (e) {
      console.log(`  -> ERROR: ${e.message}`);
      if (/(-412|-509|-799)/.test(e.message)) {
        hitRateLimit = true;
        break;
      }
      blocked.add(v.bvid);
    }

    progress.completed = [...completed];
    progress.blocked = [...blocked];
    progress.lastItem = v.bvid;
    progress.stats = { ...(progress.stats || {}), totalDanmaku };
    await saveProgress(cfg.progressFile, progress);

    if ((i + 1) % 25 === 0 || i === batch.length - 1) {
      console.log(`\n--- ${completed.size}/${topVideos.length} videos | ${totalDanmaku.toLocaleString()} danmaku ---`);
    }
    if (hitRateLimit) break;
  }

  const remaining = topVideos.length - completed.size - blocked.size;
  console.log(`\n=== Turn complete: ${completed.size}/${topVideos.length} done, ${remaining} left ===`);
  if (remaining === 0) {
    progress.danmaku_deep_done = true;
    await saveProgress(cfg.progressFile, progress);
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

const HANDLERS = {
  'bilibili-seed-scrape': runSeedScrapeTask,
  'bilibili-keyword-search': runKeywordSearchTask,
  'bilibili-danmaku-deep': runDanmakuDeepTask,
  'tieba-keyword-scrape': runTiebaScrapeTask,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Find task
  let cfg;
  if (args.taskName) {
    try {
      cfg = await loadJson(join(TASKS_DIR, `${args.taskName}.json`));
    } catch {
      // Try with .json extension
      const fname = args.taskName.endsWith('.json') ? args.taskName : `${args.taskName}.json`;
      cfg = await loadJson(join(TASKS_DIR, fname));
    }
  } else {
    const active = await listActiveTasks();
    if (active.length === 0) {
      console.log('No active tasks found in .claude/tasks/');
      console.log('Create a task config or set "active": true on an existing one.');
      process.exit(0);
    }
    cfg = active[0];
    console.log(`Auto-selected active task: ${cfg.name}`);
  }

  if (!cfg.type || !HANDLERS[cfg.type]) {
    console.error(`Unknown task type: ${cfg.type}. Supported: ${Object.keys(HANDLERS).join(', ')}`);
    process.exit(1);
  }

  const handler = HANDLERS[cfg.type];
  await handler(cfg, args.batchSize, args.round);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
