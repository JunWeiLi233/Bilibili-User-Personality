import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const PROGRESS_PATH = join(DATA_DIR, 'batch-scrape-aicu-browser-progress.json');

const DELAY_BETWEEN_UIDS = 5000;
const MAX_PAGES = 3;
const TIMEOUT_MS = 120000;
const SAVE_EVERY_ATTEMPTS = 10;
const BROWSER_COMMAND = 'browser-harness';
const SCRIPT_PATH = 'server/scripts/browserScrapeAicu.py';
const WRAPPER_PATH = 'server/data/_browser_aicu_tmp.py';
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

function sampleInvocation(uid) {
  return {
    uid,
    wrapperArgv: uid ? ['browserScrapeAicu.py', uid, String(MAX_PAGES)] : [],
    exec: `${BROWSER_COMMAND} -c "exec(open('${WRAPPER_PATH}').read())"`,
  };
}

export function buildAicuBrowserBatchPlan(payload = {}) {
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
    range: { requestedStart, effectiveStart, end, total },
    progress: {
      lastUid,
      completed: parseIntOr(progress.completed, 0),
      errors: Array.isArray(progress.errors) ? progress.errors.length : 0,
    },
    database: {
      users: Object.keys(users).length,
      existingInEffectiveRange: countUsersInRange(users, effectiveStart, end),
    },
    browser: {
      command: BROWSER_COMMAND,
      script: SCRIPT_PATH,
      wrapper: WRAPPER_PATH,
      timeoutMs: TIMEOUT_MS,
      maxPages: MAX_PAGES,
    },
    pacing: {
      delayBetweenUidsMs: DELAY_BETWEEN_UIDS,
      saveEveryAttempts: SAVE_EVERY_ATTEMPTS,
    },
    sampleInvocation: sampleInvocation(sampleUid),
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
  let pythonPlan = process.env.BILIBILI_AICU_BROWSER_USE_PYTHON_PLAN === '1';
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
  if (jsPlan) pythonPlan = false;
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

async function runPythonAicuBrowserBatchPlan(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.aicu_browser_batch_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function scrapeViaBrowser(uid) {
  try {
    const scriptPath = join(process.cwd(), 'server', 'scripts', 'browserScrapeAicu.py').replace(/\\/g, '/');
    const wrapperPath = join(process.cwd(), 'server', 'data', '_browser_aicu_tmp.py').replace(/\\/g, '/');
    const wrapper = `import sys\nsys.argv = ['browserScrapeAicu.py', '${uid}', '${MAX_PAGES}']\nexec(open('${scriptPath}').read())\n`;
    writeFileSync(wrapperPath, wrapper);
    const output = execSync(`browser-harness -c "exec(open('${wrapperPath}').read())"`, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      cwd: process.cwd(),
    });
    // Find the JSON output (last line that starts with {)
    const lines = output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('{')) {
        return JSON.parse(lines[i]);
      }
    }
    return null;
  } catch (err) {
    console.log(`    Browser error: ${err.message.split('\n')[0]}`);
    return null;
  }
}

async function loadDatabase() {
  try { return JSON.parse(await readFile(USER_DB_PATH, 'utf8')); }
  catch { return { users: {}, lastUpdated: null }; }
}

async function saveDatabase(db) {
  await mkdir(dirname(USER_DB_PATH), { recursive: true });
  db.lastUpdated = new Date().toISOString();
  await writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function loadProgress() {
  try { return JSON.parse(await readFile(PROGRESS_PATH, 'utf8')); }
  catch { return { lastUid: 0, completed: 0, errors: [], startTime: new Date().toISOString() }; }
}

async function saveProgress(progress) {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true });
  await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const control = parsePlanControlArgs(args);
  if (control.planJson) {
    if (control.pythonPlan && control.payloadPath) {
      console.log(JSON.stringify(await runPythonAicuBrowserBatchPlan(control.payloadPath), null, 2));
      return;
    }
    const payload = await readPlanPayload(args);
    console.log(JSON.stringify(buildAicuBrowserBatchPlan(payload), null, 2));
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

  if (progress.lastUid >= startUid) {
    startUid = progress.lastUid + 1;
  }

  console.log(`=== Browser-based AICU Scraper ===`);
  console.log(`UID range: ${startUid}-${endUid}`);
  console.log(`Database: ${Object.keys(db.users).length} users`);
  console.log(`Resume from: UID ${startUid}\n`);

  let scraped = 0;
  let skipped = 0;
  let errors = 0;

  for (let uid = startUid; uid <= endUid; uid++) {
    const uidStr = String(uid);

    if (db.users[uidStr]) {
      skipped++;
      continue;
    }

    try {
      const progressPct = ((uid - startUid) / (endUid - startUid) * 100).toFixed(1);
      console.log(`[${progressPct}%] UID ${uidStr}...`);

      const result = scrapeViaBrowser(uidStr);

      if (!result) {
        console.log(`  No data`);
        db.users[uidStr] = {
          uid: uidStr,
          commentCount: 0,
          danmakuCount: 0,
          commentText: '',
          danmakuText: '',
          combinedText: '',
          comments: [],
          danmaku: [],
          scrapedAt: new Date().toISOString(),
        };
      } else {
        const commentText = result.comments.map((c) => c.message).join('\n');
        const danmakuText = result.danmaku.map((d) => d.content).join('\n');
        const combinedText = [commentText, danmakuText].filter(Boolean).join('\n');

        db.users[uidStr] = {
          uid: uidStr,
          commentCount: result.commentCount,
          danmakuCount: result.danmakuCount,
          commentText,
          danmakuText,
          combinedText,
          comments: result.comments,
          danmaku: result.danmaku,
          scrapedAt: new Date().toISOString(),
        };

        if (result.commentCount > 0 || result.danmakuCount > 0) {
          console.log(`  ✓ ${result.commentCount} comments + ${result.danmakuCount} danmaku`);
          scraped++;
        } else {
          console.log(`  No comments or danmaku`);
        }
      }

      if ((scraped + errors) % SAVE_EVERY_ATTEMPTS === 0) {
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
      progress.errors.push({ uid: uidStr, error: err.message, time: new Date().toISOString() });
    }
  }

  await saveDatabase(db);
  progress.completed = scraped;
  progress.endTime = new Date().toISOString();
  await saveProgress(progress);

  console.log(`\n=== Complete ===`);
  console.log(`Scraped: ${scraped} users`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total in database: ${Object.keys(db.users).length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
