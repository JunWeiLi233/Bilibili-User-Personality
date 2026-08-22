import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const AICU_COMMENTS_API = 'https://api.aicu.cc/api/v3/search/getreply';
const AICU_DANMAKU_API = 'https://api.aicu.cc/api/v3/search/getvideodm';
const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const PROGRESS_PATH = join(DATA_DIR, 'batch-scrape-progress.json');

// Very conservative delays to avoid WAF
const DELAY_BETWEEN_PAGES = 10000;
const DELAY_BETWEEN_UIDS = 20000;
const DELAY_AFTER_WAF = 120000; // 2 minutes after WAF block
const MAX_RETRIES = 3;
const MAX_PAGES = 3;
const PAGE_SIZE = 20;
const SAVE_EVERY_ATTEMPTS = 5;
const WAF_STATUSES = [429, 468, 1015];
const execFileAsync = promisify(execFile);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBatchPlanArgs(argv = []) {
  const options = { start: 100000, end: 200000 };
  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--start=')) options.start = parseIntOr(arg.split('=')[1], 100000);
    if (arg.startsWith('--end=')) options.end = parseIntOr(arg.split('=')[1], 200000);
  }
  return options;
}

function countUsersInRange(users, start, end) {
  return Object.keys(users).filter((uid) => {
    const numericUid = parseIntOr(uid, -1);
    return start <= numericUid && numericUid <= end;
  }).length;
}

function sampleRequests(uid) {
  return {
    uid,
    commentsUrl: uid ? `${AICU_COMMENTS_API}?uid=${uid}&pn=1&ps=${PAGE_SIZE}&mode=0&keyword=` : '',
    danmakuUrl: uid ? `${AICU_DANMAKU_API}?uid=${uid}&pn=1&ps=${PAGE_SIZE}&keyword=` : '',
  };
}

export function buildAicuBatchPlan(payload = {}) {
  const planPayload = payload && typeof payload === 'object' ? payload : {};
  const argv = Array.isArray(planPayload.argv) ? planPayload.argv : [];
  const progress = planPayload.progress && typeof planPayload.progress === 'object' ? planPayload.progress : {};
  const database = planPayload.database && typeof planPayload.database === 'object' ? planPayload.database : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  const { start: requestedStart, end } = parseBatchPlanArgs(argv);
  const lastUid = parseIntOr(progress.lastUid, 0);
  const effectiveStart = lastUid >= requestedStart ? lastUid + 1 : requestedStart;
  const total = Math.max(0, end - effectiveStart + 1);
  const sampleUid = total ? String(effectiveStart) : '';

  return {
    ok: true,
    range: {
      requestedStart,
      effectiveStart,
      end,
      total,
    },
    progress: {
      lastUid,
      completed: parseIntOr(progress.completed, 0),
      errors: Array.isArray(progress.errors) ? progress.errors.length : 0,
    },
    database: {
      users: Object.keys(users).length,
      existingInEffectiveRange: countUsersInRange(users, effectiveStart, end),
    },
    limits: {
      maxPages: MAX_PAGES,
      pageSize: PAGE_SIZE,
      saveEveryAttempts: SAVE_EVERY_ATTEMPTS,
    },
    pacing: {
      delayBetweenPagesMs: DELAY_BETWEEN_PAGES,
      delayBetweenUidsMs: DELAY_BETWEEN_UIDS,
      delayAfterWafMs: DELAY_AFTER_WAF,
    },
    retry: {
      maxRetries: MAX_RETRIES,
      wafStatuses: WAF_STATUSES,
      headers: {
        accept: 'application/json',
        referer: 'https://www.aicu.cc/',
        hasUserAgent: true,
      },
    },
    sampleRequests: sampleRequests(sampleUid),
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

function parsePlanControlArgs(args = []) {
  let planJson = false;
  let pythonPlan = false;
  let jsPlan = false;
  let payloadPath = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--plan-json') {
      planJson = true;
    } else if (arg === '--python-plan') {
      pythonPlan = true;
    } else if (arg === '--js-plan') {
      jsPlan = true;
    } else if (arg === '--payload') {
      payloadPath = String(args[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length);
    }
  }
  if (process.env.AICU_BATCH_USE_PYTHON_PLAN === '1' && !jsPlan) {
    pythonPlan = true;
  }
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

async function runPythonAicuBatchPlan(payloadPath) {
  const pythonBin = process.env.AICU_BATCH_PYTHON_BIN || 'python';
  const { stdout } = await execFileAsync(pythonBin, ['-m', 'python_backend.cli.aicu_batch_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.aicu.cc/',
        },
      });
      if (response.ok) return await response.json();
      if (response.status === 429 || response.status === 468 || response.status === 1015) {
        console.log(`    WAF/Rate limit (HTTP ${response.status}), waiting ${DELAY_AFTER_WAF / 1000}s... (attempt ${attempt}/${retries})`);
        await wait(DELAY_AFTER_WAF);
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`    Error: ${err.message}, retrying... (attempt ${attempt}/${retries})`);
      await wait(DELAY_AFTER_WAF);
    }
  }
  return null;
}

async function scrapeComments(uid) {
  const allComments = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${AICU_COMMENTS_API}?uid=${uid}&pn=${page}&ps=20&mode=0&keyword=`;
    const data = await fetchWithRetry(url);
    if (!data || data.code !== 0 || !data.data?.replies?.length) break;
    allComments.push(...data.data.replies);
    if (data.data.cursor?.is_end) break;
    if (page < MAX_PAGES) await wait(DELAY_BETWEEN_PAGES);
  }
  return allComments;
}

async function scrapeDanmaku(uid) {
  const allDanmaku = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${AICU_DANMAKU_API}?uid=${uid}&pn=${page}&ps=20&keyword=`;
    const data = await fetchWithRetry(url);
    if (!data || data.code !== 0 || !data.data?.videodmlist?.length) break;
    allDanmaku.push(...data.data.videodmlist);
    if (data.data.cursor?.is_end) break;
    if (page < MAX_PAGES) await wait(DELAY_BETWEEN_PAGES);
  }
  return allDanmaku;
}

async function loadDatabase() {
  try {
    return JSON.parse(await readFile(USER_DB_PATH, 'utf8'));
  } catch {
    return { users: {}, lastUpdated: null };
  }
}

async function saveDatabase(db) {
  await mkdir(dirname(USER_DB_PATH), { recursive: true });
  db.lastUpdated = new Date().toISOString();
  await writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function loadProgress() {
  try {
    return JSON.parse(await readFile(PROGRESS_PATH, 'utf8'));
  } catch {
    return { lastUid: 0, completed: 0, errors: [], startTime: new Date().toISOString() };
  }
}

async function saveProgress(progress) {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true });
  await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const planControl = parsePlanControlArgs(args);
  if (planControl.planJson) {
    if (planControl.pythonPlan && !planControl.jsPlan) {
      console.log(JSON.stringify(await runPythonAicuBatchPlan(planControl.payloadPath), null, 2));
      return;
    }
    const payload = await readPlanPayload(args);
    console.log(JSON.stringify(buildAicuBatchPlan(payload), null, 2));
    return;
  }

  let startUid = 100000;
  let endUid = 200000;

  for (const arg of args) {
    if (arg.startsWith('--start=')) startUid = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--end=')) endUid = parseInt(arg.split('=')[1]);
  }

  const db = await loadDatabase();
  const progress = await loadProgress();

  // Resume from last position
  if (progress.lastUid >= startUid) {
    startUid = progress.lastUid + 1;
  }

  console.log(`=== Batch Scrape AICU ===`);
  console.log(`UID range: ${startUid}-${endUid}`);
  console.log(`Database: ${Object.keys(db.users).length} users`);
  console.log(`Resume from: UID ${startUid}`);
  console.log(`Delays: ${DELAY_BETWEEN_UIDS / 1000}s between UIDs, ${DELAY_AFTER_WAF / 1000}s after WAF\n`);

  let scraped = 0;
  let skipped = 0;
  let errors = 0;
  let wafBlocks = 0;

  for (let uid = startUid; uid <= endUid; uid++) {
    const uidStr = String(uid);

    // Skip if already in database
    if (db.users[uidStr]) {
      skipped++;
      continue;
    }

    try {
      const progressPct = ((uid - startUid) / (endUid - startUid) * 100).toFixed(1);
      console.log(`[${progressPct}%] UID ${uidStr}...`);

      const [comments, danmaku] = await Promise.all([
        scrapeComments(uidStr),
        scrapeDanmaku(uidStr),
      ]);

      if (comments.length === 0 && danmaku.length === 0) {
        console.log(`  No data`);
      } else {
        const commentText = comments.map((c) => c.message).join('\n');
        const danmakuText = danmaku.map((d) => d.content).join('\n');
        const combinedText = [commentText, danmakuText].filter(Boolean).join('\n');

        db.users[uidStr] = {
          uid: uidStr,
          commentCount: comments.length,
          danmakuCount: danmaku.length,
          commentText,
          danmakuText,
          combinedText,
          comments: comments.map((c) => ({
            rpid: c.rpid,
            message: c.message,
            time: c.time,
            rank: c.rank,
            oid: c.dyn?.oid,
            type: c.dyn?.type,
          })),
          danmaku: danmaku.map((d) => ({
            id: d.id,
            content: d.content,
            time: d.ctime,
            oid: d.oid,
          })),
          scrapedAt: new Date().toISOString(),
        };

        console.log(`  ✓ ${comments.length} comments + ${danmaku.length} danmaku`);
        scraped++;
      }

      // Save periodically
      if ((scraped + errors) % 5 === 0) {
        await saveDatabase(db);
        progress.lastUid = uid;
        progress.completed = scraped;
        await saveProgress(progress);
      }

      progress.lastUid = uid;
      await wait(DELAY_BETWEEN_UIDS);

    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      errors++;
      wafBlocks++;
      progress.errors.push({ uid: uidStr, error: err.message, time: new Date().toISOString() });

      // If WAF blocked, wait longer
      if (err.message.includes('1015') || err.message.includes('468') || err.message.includes('429')) {
        console.log(`  WAF blocked (${wafBlocks} total), waiting ${DELAY_AFTER_WAF / 1000}s...`);
        await wait(DELAY_AFTER_WAF);
      }
    }
  }

  // Final save
  await saveDatabase(db);
  progress.completed = scraped;
  progress.endTime = new Date().toISOString();
  await saveProgress(progress);

  console.log(`\n=== Complete ===`);
  console.log(`Scraped: ${scraped} users`);
  console.log(`Skipped: ${skipped} (already in database)`);
  console.log(`Errors: ${errors}`);
  console.log(`WAF blocks: ${wafBlocks}`);
  console.log(`Total in database: ${Object.keys(db.users).length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
