/**
 * Discover UIDs from Bilibili video comments and analyze them.
 * Focuses on UIDs in the 200000-300000 range but collects all found UIDs.
 *
 * Phase 1: Scan popular/controversial videos for comments → collect UIDs
 * Phase 2: For each discovered UID, aggregate their comments and train dictionary
 *
 * Usage: node server/scripts/batchUidRange.js [--start=200000] [--end=300000] [--pages=100]
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, fetchRepliesForVideo, humanPause } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const LOCK_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json.lock');
const PROGRESS_PATH = join(DATA_DIR, 'batch-uid-range-progress.json');
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const COMMENT_PAGES_PER_VIDEO = 3;
const DELAY_BETWEEN_VIDEOS_MS = 2000;
const DELAY_BETWEEN_UIDS_MS = 1500;
const LOCK_RETRY_DELAY_MS = 3000;
const LOCK_MAX_RETRIES = 10;
const SAVE_INTERVAL = 5;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function forceRemoveLock() {
  try {
    const ownerPath = join(LOCK_PATH, 'owner.json');
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    // Check if lock owner process is still alive
    try {
      process.kill(owner.pid, 0);
      // Process is alive - don't remove lock, just wait
      console.log(`  Lock held by PID ${owner.pid}, waiting for release...`);
      return false;
    } catch {
      // Process is dead - remove stale lock
      console.log(`  Removing stale lock from dead PID ${owner.pid}`);
      await rm(LOCK_PATH, { recursive: true, force: true });
      return true;
    }
  } catch {
    // No lock file or can't read it
    try { await rm(LOCK_PATH, { recursive: true, force: true }); } catch {}
    return true;
  }
}

function jsNumberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : fallback;
}

function parseArgs(args = process.argv.slice(2)) {
  const opts = { start: 200000, end: 300000, pages: 200, phase2Only: false };
  for (const arg of args) {
    if (arg.startsWith('--start=')) opts.start = jsNumberOr(arg.split('=')[1], 200000);
    if (arg.startsWith('--end=')) opts.end = jsNumberOr(arg.split('=')[1], 300000);
    if (arg.startsWith('--pages=')) opts.pages = jsNumberOr(arg.split('=')[1], 200);
    if (arg === '--phase2-only') opts.phase2Only = true;
  }
  return opts;
}

function uidInRange(uid, start, end) {
  const value = Number(uid);
  return Number.isFinite(value) && value >= start && value <= end;
}

export function buildBatchUidRangePlan(payload = {}) {
  const planPayload = payload && typeof payload === 'object' ? payload : {};
  const argv = Array.isArray(planPayload.argv) ? planPayload.argv : [];
  const progress = planPayload.progress && typeof planPayload.progress === 'object' ? planPayload.progress : {};
  const database = planPayload.database && typeof planPayload.database === 'object' ? planPayload.database : {};
  const { start, end, pages, phase2Only } = parseArgs(argv.map((item) => String(item || '')));
  const uidComments = progress._uidComments && typeof progress._uidComments === 'object' ? progress._uidComments : {};
  const processedUids = progress.processedUids && typeof progress.processedUids === 'object' ? progress.processedUids : {};
  const scannedBvids = Array.isArray(progress.scannedBvids) ? progress.scannedBvids : [];
  const stats = progress.stats && typeof progress.stats === 'object' ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  const targetUids = Object.keys(uidComments).filter((uid) => uidInRange(uid, start, end));
  const processedTargets = targetUids.filter((uid) => uid in processedUids).length;

  return {
    ok: true,
    input: { start, end, pages, phase2Only },
    phase1: {
      enabled: !phase2Only,
      scannedBvids: scannedBvids.length,
      maxPages: pages,
      popularPageSize: 20,
      commentPagesPerVideo: COMMENT_PAGES_PER_VIDEO,
    },
    phase2: {
      targetUids: targetUids.length,
      processed: processedTargets,
      remaining: Math.max(0, targetUids.length - processedTargets),
      userDbUsers: Object.keys(users).length,
    },
    stats: {
      videosScanned: stats.videosScanned ? jsNumberOr(stats.videosScanned, 0) : 0,
      uidsFound: stats.uidsFound ? jsNumberOr(stats.uidsFound, Object.keys(uidComments).length) : Object.keys(uidComments).length,
      targetUidsFound: stats.targetUidsFound ? jsNumberOr(stats.targetUidsFound, targetUids.length) : targetUids.length,
      commentsCollected: stats.commentsCollected ? jsNumberOr(stats.commentsCollected, 0) : 0,
      analyzed: stats.analyzed ? jsNumberOr(stats.analyzed, 0) : 0,
      skipped: stats.skipped ? jsNumberOr(stats.skipped, 0) : 0,
      errors: stats.errors ? jsNumberOr(stats.errors, 0) : 0,
    },
    pacing: {
      delayBetweenVideosMs: DELAY_BETWEEN_VIDEOS_MS,
      delayBetweenUidsMs: DELAY_BETWEEN_UIDS_MS,
      lockRetryDelayMs: LOCK_RETRY_DELAY_MS,
      lockMaxRetries: LOCK_MAX_RETRIES,
      saveInterval: SAVE_INTERVAL,
    },
  };
}

async function readPlanPayload(args) {
  const payloadIndex = args.indexOf('--payload');
  if (payloadIndex === -1 || !args[payloadIndex + 1]) return {};
  try {
    return JSON.parse(await readFile(args[payloadIndex + 1], 'utf8'));
  } catch {
    return {};
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
    // Always try to remove stale locks before each attempt
    await forceRemoveLock();
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

// Phase 1: Discover UIDs from video comments
async function discoverUids(scannedBvids, uidComments, stats, maxPages) {
  console.log(`\n=== Phase 1: Scanning popular videos (up to ${maxPages} pages) ===`);
  process.stdout.write('');

  const scannedSet = new Set(scannedBvids);

  for (let page = 1; page <= maxPages; page++) {
    let videos = [];
    try {
      const url = `https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=20`;
      console.log(`  Fetching page ${page}...`);
      const data = await fetchJson(url, 'https://www.bilibili.com/v/popular/all');
      if (data.code === 0 && data.data?.list) {
        videos = data.data.list.filter((item) => item?.bvid).map((item) => ({
          bvid: item.bvid,
          title: item.title || '',
          sourceUrl: `https://www.bilibili.com/video/${item.bvid}/`,
        }));
      }
    } catch (e) {
      console.log(`  Popular page ${page}: error - ${e.message}`);
      await wait(5000);
      continue;
    }

    if (videos.length === 0) {
      console.log(`  Page ${page}: no more videos`);
      break;
    }

    for (const video of videos) {
      if (!video.bvid || scannedSet.has(video.bvid)) continue;

      try {
        console.log(`  Fetching comments for ${video.bvid}...`);
        const scan = await fetchRepliesForVideo(video.sourceUrl || video.bvid, { pages: COMMENT_PAGES_PER_VIDEO });
        if (scan.ok && scan.comments.length > 0) {
          for (const comment of scan.comments) {
            const uid = String(comment.mid || '');
            if (!uid || uid === '0') continue;
            if (!uidComments.has(uid)) uidComments.set(uid, []);
            uidComments.get(uid).push({
              message: comment.message || '',
              uname: comment.uname || '',
              bvid: video.bvid,
            });
          }
          stats.commentsCollected += scan.comments.length;
        }
        scannedSet.add(video.bvid);
        stats.videosScanned++;
      } catch (e) {
        stats.errors++;
        scannedSet.add(video.bvid);
      }

      await wait(DELAY_BETWEEN_VIDEOS_MS);
    }

    const targetUids = [...uidComments.keys()].filter((uid) => {
      const n = Number(uid);
      return n >= 200000 && n <= 300000;
    }).length;

    console.log(`  Page ${page}/${maxPages}: ${stats.videosScanned} videos, ${uidComments.size} UIDs total (${targetUids} in range), ${stats.commentsCollected} comments`);

    // Save progress after each page
    stats.uidsFound = uidComments.size;
    stats.targetUidsFound = targetUids;
    const progressData = {
      scannedBvids: [...scannedSet],
      _uidComments: Object.fromEntries([...uidComments].map(([uid, comments]) => [uid, comments])),
      processedUids: {},
      stats,
      lastUpdated: new Date().toISOString(),
    };
    await saveJson(PROGRESS_PATH, progressData);
  }

  return [...scannedSet];
}

// Phase 2: Analyze discovered UIDs
async function analyzeUids(uidComments, processedUids, userDb, stats, startRange, endRange) {
  const targetUids = [...uidComments.keys()].filter((uid) => {
    const n = Number(uid);
    return n >= startRange && n <= endRange;
  });

  console.log(`\n=== Phase 2: Analyzing ${targetUids.length} UIDs in range ${startRange}-${endRange} ===`);

  let analyzed = 0;

  for (const uid of targetUids) {
    if (processedUids[uid]) {
      stats.skipped++;
      continue;
    }

    const comments = uidComments.get(uid) || [];
    const commentText = comments.map((c) => c.message).filter(Boolean).join('\n');

    if (!commentText.trim()) {
      processedUids[uid] = 'no_text';
      stats.skipped++;
      continue;
    }

    console.log(`  Processing UID ${uid} (${comments.length} comments, ${commentText.length} chars)...`);

    // Save to user DB
    userDb.users[uid] = {
      uid,
      uname: comments[0]?.uname || '',
      commentCount: comments.length,
      combinedText: commentText.slice(0, 5000),
      bvids: [...new Set(comments.map((c) => c.bvid))],
      scrapedAt: new Date().toISOString(),
    };

    try {
      await trainWithRetry({
        text: commentText,
        uid,
        source: `Popular video comments UID ${uid} (${comments.length} comments from ${new Set(comments.map((c) => c.bvid)).size} videos)`,
      }, { existingTermsOnly: false });

      processedUids[uid] = 'success';
      analyzed++;
      stats.analyzed++;
    } catch (e) {
      processedUids[uid] = `error: ${e.message}`;
      stats.errors++;
    }

    if (analyzed % SAVE_INTERVAL === 0) {
      console.log(`  Analyzed ${analyzed}/${targetUids.length} UIDs...`);
      await saveJson(USER_DB_PATH, userDb);
      await saveJson(PROGRESS_PATH, {
        scannedBvids: [],
        _uidComments: Object.fromEntries([...uidComments].map(([uid, comments]) => [uid, comments])),
        processedUids,
        stats,
        lastUpdated: new Date().toISOString(),
      });
    }

    await wait(DELAY_BETWEEN_UIDS_MS);
  }

  return analyzed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--plan-json')) {
    const payload = await readPlanPayload(args);
    console.log(JSON.stringify(buildBatchUidRangePlan(payload), null, 2));
    return;
  }

  const { start, end, pages, phase2Only } = parseArgs(args);

  // Clean up stale locks on startup
  await forceRemoveLock();

  // Load existing progress
  const existing = await loadJson(PROGRESS_PATH, {
    scannedBvids: [],
    _uidComments: {},
    processedUids: {},
    stats: { videosScanned: 0, uidsFound: 0, targetUidsFound: 0, commentsCollected: 0, analyzed: 0, skipped: 0, errors: 0 },
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });

  console.log(`UID range batch scraper: target range ${start}-${end}`);
  console.log(`Previously: ${existing.scannedBvids.length} videos scanned, ${Object.keys(existing._uidComments || {}).length} UIDs discovered\n`);

  // Phase 1: Discover UIDs
  const uidComments = new Map(Object.entries(existing._uidComments || {}));
  const scannedBvids = existing.scannedBvids;
  const stats = existing.stats;

  if (!phase2Only) {
    await discoverUids(scannedBvids, uidComments, stats, pages);
  } else {
    console.log('Skipping Phase 1 (--phase2-only)');
  }

  // Phase 2: Analyze UIDs in target range
  const processedUids = existing.processedUids || {};
  await analyzeUids(uidComments, processedUids, userDb, stats, start, end);

  // Final save
  await saveJson(PROGRESS_PATH, {
    scannedBvids,
    processedUids,
    stats,
    lastUpdated: new Date().toISOString(),
  });
  await saveJson(USER_DB_PATH, userDb);

  console.log('\n=== DONE ===');
  console.log(`Videos scanned: ${stats.videosScanned}`);
  console.log(`Comments collected: ${stats.commentsCollected}`);
  console.log(`UIDs discovered: ${stats.uidsFound}`);
  console.log(`UIDs in range ${start}-${end}: ${stats.targetUidsFound}`);
  console.log(`Analyzed: ${stats.analyzed}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
