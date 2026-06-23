import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, fetchRepliesForVideo, humanPause } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, 'batch-uid-progress.json');
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const POPULAR_PAGES = 50;
const VIDEOS_PER_PAGE = 20;
const COMMENT_PAGES_PER_VIDEO = 3;
const DELAY_BETWEEN_VIDEOS_MS = 2000;
const LOCK_RETRY_DELAY_MS = 10000;
const LOCK_MAX_RETRIES = 10;
const SAVE_EVERY_ANALYZED = 10;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err?.message || err);
});

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function commentText(comments) {
  if (!Array.isArray(comments)) return '';
  return comments.map((comment) => (comment && typeof comment === 'object' ? String(comment.message || '') : '')).join('\n');
}

export function buildBatchUidScrapePlan(payload = {}) {
  const planPayload = payload && typeof payload === 'object' ? payload : {};
  const progress = planPayload.progress && typeof planPayload.progress === 'object' ? planPayload.progress : {};
  const database = planPayload.database && typeof planPayload.database === 'object' ? planPayload.database : {};
  const uidComments = progress._uidComments && typeof progress._uidComments === 'object' ? progress._uidComments : {};
  const processedUids = progress.processedUids && typeof progress.processedUids === 'object' ? progress.processedUids : {};
  const scannedBvids = Array.isArray(progress.scannedBvids) ? progress.scannedBvids : [];
  const stats = progress.stats && typeof progress.stats === 'object' ? progress.stats : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  const pendingItems = Object.entries(uidComments).filter(([uid]) => !processedUids[uid]);
  const skippableNoText = pendingItems.filter(([, comments]) => !commentText(comments).trim()).length;
  const trainable = pendingItems.length - skippableNoText;

  return {
    ok: true,
    discovery: {
      popularPages: POPULAR_PAGES,
      videosPerPage: VIDEOS_PER_PAGE,
      commentPagesPerVideo: COMMENT_PAGES_PER_VIDEO,
      scannedBvids: scannedBvids.length,
      uidsDiscovered: Object.keys(uidComments).length,
    },
    phase2: {
      processed: Object.keys(processedUids).length,
      pending: pendingItems.length,
      skippableNoText,
      trainable,
      userDbUsers: Object.keys(users).length,
    },
    stats: {
      videosScanned: parseIntOr(stats.videosScanned, 0),
      uidsFound: parseIntOr(stats.uidsFound, 0) || Object.keys(uidComments).length,
      uidsAnalyzed: parseIntOr(stats.uidsAnalyzed, 0),
      commentsCollected: parseIntOr(stats.commentsCollected, 0),
      errors: parseIntOr(stats.errors, 0),
    },
    training: { multiagent: true, existingTermsOnly: false, saveEveryAnalyzed: SAVE_EVERY_ANALYZED },
    pacing: {
      delayBetweenVideosMs: DELAY_BETWEEN_VIDEOS_MS,
      lockRetryDelayMs: LOCK_RETRY_DELAY_MS,
      lockMaxRetries: LOCK_MAX_RETRIES,
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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--plan-json')) {
    const payload = await readPlanPayload(args);
    console.log(JSON.stringify(buildBatchUidScrapePlan(payload), null, 2));
    return;
  }

  const progress = await loadJson(PROGRESS_PATH, {
    scannedBvids: [],
    processedUids: {},
    stats: { videosScanned: 0, uidsFound: 0, uidsAnalyzed: 0, commentsCollected: 0, errors: 0 },
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });

  console.log('Bilibili comment scanner - video-based approach');
  console.log(`Previously: ${progress.scannedBvids.length} videos scanned, ${Object.keys(progress.processedUids).length} UIDs processed\n`);

  const scannedSet = new Set(progress.scannedBvids);
  // Restore uidComments from saved progress if resuming
  const uidComments = new Map(
    progress._uidComments ? Object.entries(progress._uidComments) : []
  );
  delete progress._uidComments; // Don't keep in memory twice

  // Phase 1: Discover videos and collect comments
  console.log('=== Phase 1: Scanning popular videos for comments ===');
  for (let page = 1; page <= POPULAR_PAGES; page++) {
    let videos = [];
    try {
      const url = `https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=${VIDEOS_PER_PAGE}`;
      const data = await fetchJson(url, 'https://www.bilibili.com/v/popular/all');
      if (data.code === 0 && data.data?.list) {
        videos = data.data.list.filter(item => item?.bvid).map(item => ({
          bvid: item.bvid,
          aid: item.aid,
          title: item.title || '',
          sourceUrl: `https://www.bilibili.com/video/${item.bvid}/`,
        }));
      }
    } catch (e) {
      console.log(`Popular page ${page}: error - ${e.message}`);
      await wait(5000);
      continue;
    }

    if (videos.length === 0) break;

    for (const video of videos) {
      const bvid = video.bvid || '';
      if (!bvid || scannedSet.has(bvid)) continue;

      try {
        const scan = await fetchRepliesForVideo(video.sourceUrl || bvid, { pages: COMMENT_PAGES_PER_VIDEO });
        if (scan.ok && scan.comments.length > 0) {
          for (const comment of scan.comments) {
            const uid = String(comment.mid || '');
            if (!uid || uid === '0') continue;
            if (!uidComments.has(uid)) uidComments.set(uid, []);
            uidComments.get(uid).push({
              message: comment.message || '',
              uname: comment.uname || '',
              bvid,
            });
          }
          progress.stats.commentsCollected += scan.comments.length;
        }
        scannedSet.add(bvid);
        progress.stats.videosScanned++;
      } catch (e) {
        progress.stats.errors++;
        scannedSet.add(bvid);
      }

      await wait(DELAY_BETWEEN_VIDEOS_MS);
    }

    console.log(`Page ${page}/${POPULAR_PAGES}: ${progress.stats.videosScanned} videos, ${uidComments.size} UIDs, ${progress.stats.commentsCollected} comments`);

    // Save progress after each page (for resume support)
    progress.scannedBvids = [...scannedSet];
    progress.stats.uidsFound = uidComments.size;
    // Persist uidComments into progress for Phase 2 resume
    progress._uidComments = Object.fromEntries([...uidComments].map(([uid, comments]) => [uid, comments]));
    await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  }

  // Save scanned BV ids
  progress.scannedBvids = [...scannedSet];
  progress.stats.uidsFound = uidComments.size;

  // Phase 2: Analyze each UID's comments
  console.log(`\n=== Phase 2: Analyzing ${uidComments.size} UIDs ===`);
  let analyzed = 0;
  let skipped = 0;

  for (const [uid, comments] of uidComments) {
    if (progress.processedUids[uid]) {
      skipped++;
      continue;
    }

    const commentText = comments.map(c => c.message).filter(Boolean).join('\n');
    if (!commentText.trim()) {
      progress.processedUids[uid] = 'no_text';
      skipped++;
      continue;
    }

    // Save to user DB
    userDb.users[uid] = {
      uid,
      uname: comments[0]?.uname || '',
      commentCount: comments.length,
      commentText: commentText.slice(0, 5000),
      bvids: [...new Set(comments.map(c => c.bvid))],
      scrapedAt: new Date().toISOString(),
    };

    try {
      await trainWithRetry({
        text: commentText,
        uid,
        source: `Popular video comments for UID ${uid} (${comments.length} comments from ${new Set(comments.map(c => c.bvid)).size} videos)`,
      }, { existingTermsOnly: false });

      progress.processedUids[uid] = 'success';
      analyzed++;
      progress.stats.uidsAnalyzed++;
    } catch (e) {
      progress.processedUids[uid] = 'error';
      progress.stats.errors++;
    }

    if (analyzed % SAVE_EVERY_ANALYZED === 0) {
      console.log(`  Analyzed ${analyzed}/${uidComments.size - skipped} UIDs...`);
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
      await saveJson(USER_DB_PATH, userDb);
    }
  }

  // Final save
  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  await saveJson(USER_DB_PATH, userDb);

  console.log('\n=== DONE ===');
  console.log(`Videos scanned: ${progress.stats.videosScanned}`);
  console.log(`Comments collected: ${progress.stats.commentsCollected}`);
  console.log(`Unique UIDs found: ${progress.stats.uidsFound}`);
  console.log(`UIDs analyzed: ${progress.stats.uidsAnalyzed}`);
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
