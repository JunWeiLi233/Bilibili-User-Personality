import { execFile, execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const PROGRESS_PATH = join(DATA_DIR, 'batch-scrape-bilibili-progress.json');

const DELAY_BETWEEN_REQUESTS = 3000;
const DELAY_BETWEEN_UIDS = 15000;
const DELAY_AFTER_RATE_LIMIT = 60000;
const MAX_RETRIES = 3;
const MAX_VIDEOS = 3;
const MAX_COMMENTS = 50;
const VIDEO_REPLY_PAGES = 1;
const BROWSER_TIMEOUT_MS = 45000;
const RATE_LIMIT_CODES = [-799, -412];
const BROWSER_COMMAND = 'browser-harness';
const BROWSER_SCRIPT = 'server/scripts/browserGetVideos.py';
const BROWSER_WRAPPER = 'server/data/_browser_tmp.py';
const execFileAsync = promisify(execFile);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSampleRequests(uid) {
  return {
    uid,
    cardUrl: uid ? `https://api.bilibili.com/x/web-interface/card?mid=${uid}` : '',
    replyUrl: uid ? 'https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1' : '',
    wrapperArgv: uid ? ['browserGetVideos.py', uid, String(MAX_VIDEOS)] : [],
  };
}

export function buildBatchBilibiliPlan(payload = {}) {
  const planPayload = payload && typeof payload === 'object' ? payload : {};
  const argv = Array.isArray(planPayload.argv) ? planPayload.argv : [];
  const progress = planPayload.progress && typeof planPayload.progress === 'object' ? planPayload.progress : {};
  const database = planPayload.database && typeof planPayload.database === 'object' ? planPayload.database : {};
  const users = database.users && typeof database.users === 'object' ? database.users : {};
  let startUid = 100000;
  let endUid = 200000;

  for (const raw of argv) {
    const arg = String(raw || '');
    if (arg.startsWith('--start=')) startUid = parseIntOr(arg.split('=')[1], startUid);
    if (arg.startsWith('--end=')) endUid = parseIntOr(arg.split('=')[1], endUid);
  }
  if (startUid <= 0) startUid = 100000;
  if (endUid <= 0) endUid = 200000;

  const inputStart = startUid;
  const lastUid = parseIntOr(progress.lastUid, 0);
  const resumed = lastUid >= startUid;
  if (resumed) startUid = lastUid + 1;
  const total = Math.max(0, endUid - startUid + 1);
  const sampleUid = total ? String(startUid) : '';

  return {
    ok: true,
    input: { startUid: inputStart, endUid },
    range: { startUid, endUid, total },
    resume: { lastUid, resumed },
    database: { users: Object.keys(users).length },
    limits: { maxVideos: MAX_VIDEOS, maxComments: MAX_COMMENTS, replyPages: VIDEO_REPLY_PAGES },
    pacing: {
      delayBetweenRequestsMs: DELAY_BETWEEN_REQUESTS,
      delayBetweenUidsMs: DELAY_BETWEEN_UIDS,
      delayAfterRateLimitMs: DELAY_AFTER_RATE_LIMIT,
    },
    retry: {
      maxRetries: MAX_RETRIES,
      rateLimitCodes: RATE_LIMIT_CODES,
      htmlWafDetection: true,
      hasUserAgent: true,
      referer: 'https://www.bilibili.com/',
    },
    browser: {
      command: BROWSER_COMMAND,
      script: BROWSER_SCRIPT,
      wrapper: BROWSER_WRAPPER,
      timeoutMs: BROWSER_TIMEOUT_MS,
      maxVideos: MAX_VIDEOS,
    },
    sampleRequests: buildSampleRequests(sampleUid),
    progress: {
      completed: parseIntOr(progress.completed, 0),
      errors: Array.isArray(progress.errors) ? progress.errors.length : 0,
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
  if (process.env.BILIBILI_BATCH_USE_PYTHON_PLAN === '1' && !jsPlan) {
    pythonPlan = true;
  }
  return { planJson, pythonPlan, jsPlan, payloadPath };
}

async function runPythonBatchBilibiliPlan(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.batch_bilibili_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
        },
      });
      const text = await response.text();
      if (text.startsWith('<')) throw new Error('HTML response (WAF/rate limit)');
      const data = JSON.parse(text);
      if (data.code === 0) return data;
      if (RATE_LIMIT_CODES.includes(data.code)) {
        console.log(`    Rate limited (${data.code}), waiting ${DELAY_AFTER_RATE_LIMIT / 1000}s...`);
        await wait(DELAY_AFTER_RATE_LIMIT);
        continue;
      }
      throw new Error(`API error: ${data.code} - ${data.message}`);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`    Error: ${err.message}, retrying...`);
      await wait(DELAY_AFTER_RATE_LIMIT);
    }
  }
  return null;
}

function getUserVideosViaBrowser(mid) {
  try {
    const scriptPath = join(process.cwd(), 'server', 'scripts', 'browserGetVideos.py').replace(/\\/g, '/');
    // Write a wrapper script that imports and runs with args
    const wrapperPath = join(process.cwd(), 'server', 'data', '_browser_tmp.py').replace(/\\/g, '/');
    const wrapper = `import sys\nsys.argv = ['browserGetVideos.py', '${mid}', '${MAX_VIDEOS}']\nexec(open('${scriptPath}').read())\n`;
    writeFileSync(wrapperPath, wrapper);
    const output = execSync(`browser-harness -c "exec(open('${wrapperPath}').read())"`, {
      encoding: 'utf8',
      timeout: BROWSER_TIMEOUT_MS,
      cwd: process.cwd(),
    });
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [aid, bvid, commentCount] = line.split('|');
      return { aid: parseInt(aid), bvid, commentCount: parseInt(commentCount) };
    });
  } catch (err) {
    console.log(`    Browser error: ${err.message.split('\n')[0]}`);
    return [];
  }
}

async function fetchUserCard(mid) {
  const url = `https://api.bilibili.com/x/web-interface/card?mid=${mid}`;
  try {
    const data = await fetchJson(url);
    return data?.data?.card || null;
  } catch {
    return null;
  }
}

async function fetchVideoReplies(aid, maxPages = 2) {
  const allReplies = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const url = `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=${pn}&ps=20&sort=1`;
    const data = await fetchJson(url);
    if (!data || !data.data?.replies?.length) break;
    allReplies.push(...data.data.replies);
    if (pn < maxPages) await wait(DELAY_BETWEEN_REQUESTS);
  }
  return allReplies;
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
      console.log(JSON.stringify(await runPythonBatchBilibiliPlan(planControl.payloadPath), null, 2));
      return;
    }
    const payload = await readPlanPayload(args);
    console.log(JSON.stringify(buildBatchBilibiliPlan(payload), null, 2));
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

  console.log(`=== Batch Scrape Bilibili ===`);
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

      // Get user card info
      const card = await fetchUserCard(uidStr);
      const userName = card?.name || `UID ${uidStr}`;

      // Get user's videos via browser
      const videos = getUserVideosViaBrowser(uidStr);
      console.log(`  Found ${videos.length} videos`);

      if (videos.length === 0) {
        db.users[uidStr] = {
          uid: uidStr,
          name: userName,
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
        // Scrape comments from user's videos
        const userComments = [];
        for (const video of videos) {
          try {
            const replies = await fetchVideoReplies(video.aid, 1);
            const found = replies.filter(r => String(r.member?.mid) === uidStr);
            userComments.push(...found.map(r => ({
              rpid: String(r.rpid),
              message: r.content?.message || '',
              time: r.ctime,
              oid: String(video.aid),
            })));
            console.log(`  Video ${video.bvid}: ${replies.length} comments, ${found.length} from user`);
            if (userComments.length >= MAX_COMMENTS) break;
            await wait(DELAY_BETWEEN_REQUESTS);
          } catch (err) {
            console.log(`  Video ${video.bvid}: Error - ${err.message}`);
          }
        }

        const commentText = userComments.map((c) => c.message).join('\n');

        db.users[uidStr] = {
          uid: uidStr,
          name: userName,
          commentCount: userComments.length,
          danmakuCount: 0,
          commentText,
          danmakuText: '',
          combinedText: commentText,
          comments: userComments,
          danmaku: [],
          scrapedAt: new Date().toISOString(),
        };

        if (userComments.length > 0) {
          console.log(`  ✓ ${userComments.length} comments from user`);
          scraped++;
        } else {
          console.log(`  No comments from user`);
        }
      }

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
