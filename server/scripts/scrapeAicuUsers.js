import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const AICU_COMMENTS_API = 'https://api.aicu.cc/api/v3/search/getreply';
const AICU_DANMAKU_API = 'https://api.aicu.cc/api/v3/search/getvideodm';
const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const DELAY_MS = 5000;
const RETRY_DELAY_MS = 15000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAicuComments(uid, page = 1, pageSize = 20) {
  const url = `${AICU_COMMENTS_API}?uid=${uid}&pn=${page}&ps=${pageSize}&mode=0&keyword=`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchAicuDanmaku(uid, page = 1, pageSize = 20) {
  const url = `${AICU_DANMAKU_API}?uid=${uid}&pn=${page}&ps=${pageSize}&keyword=`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function scrapeUserComments(uid, maxPages = 10) {
  const allComments = [];
  let retries = 0;
  const maxRetries = 3;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuComments(uid, page);
      if (data.code !== 0 || !data.data?.replies?.length) break;
      allComments.push(...data.data.replies);
      if (data.data.cursor?.is_end) break;
      await wait(DELAY_MS);
      retries = 0; // Reset retries on success
    } catch (err) {
      if (err.message.includes('429') || err.message.includes('468')) {
        if (retries >= maxRetries) {
          console.log(`  Max retries reached for comments page ${page}, skipping`);
          break;
        }
        retries++;
        console.log(`  Rate limited on comments page ${page}, waiting ${RETRY_DELAY_MS / 1000}s... (retry ${retries}/${maxRetries})`);
        await wait(RETRY_DELAY_MS);
        page--; // Retry this page
        continue;
      }
      console.error(`  Error fetching comments page ${page}: ${err.message}`);
      break;
    }
  }
  return allComments;
}

async function scrapeUserDanmaku(uid, maxPages = 10) {
  const allDanmaku = [];
  let retries = 0;
  const maxRetries = 3;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuDanmaku(uid, page);
      if (data.code !== 0 || !data.data?.videodmlist?.length) break;
      allDanmaku.push(...data.data.videodmlist);
      if (data.data.cursor?.is_end) break;
      await wait(DELAY_MS);
      retries = 0; // Reset retries on success
    } catch (err) {
      if (err.message.includes('429') || err.message.includes('468')) {
        if (retries >= maxRetries) {
          console.log(`  Max retries reached for danmaku page ${page}, skipping`);
          break;
        }
        retries++;
        console.log(`  Rate limited on danmaku page ${page}, waiting ${RETRY_DELAY_MS / 1000}s... (retry ${retries}/${maxRetries})`);
        await wait(RETRY_DELAY_MS);
        page--; // Retry this page
        continue;
      }
      console.error(`  Error fetching danmaku page ${page}: ${err.message}`);
      break;
    }
  }
  return allDanmaku;
}

async function loadDatabase() {
  try {
    const data = await readFile(USER_DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return { users: {}, lastUpdated: null };
  }
}

async function saveDatabase(db) {
  await mkdir(dirname(USER_DB_PATH), { recursive: true });
  db.lastUpdated = new Date().toISOString();
  await writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function extractUidFromLink(link) {
  // Handle space.bilibili.com URLs
  const spaceMatch = link.match(/space\.bilibili\.com\/(\d+)/);
  if (spaceMatch) return spaceMatch[1];
  // Handle raw UIDs
  if (/^\d+$/.test(link.trim())) return link.trim();
  return null;
}

function parsePlanArgs(argv = process.argv.slice(2)) {
  let planJson = false;
  let payloadPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--plan-json') {
      planJson = true;
    } else if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length);
    } else if (arg === '--payload') {
      payloadPath = String(argv[index + 1] || '');
      index += 1;
    }
  }
  return { planJson, payloadPath };
}

async function readPlanPayload(path) {
  if (!path) return {};
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function parseIntOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

async function collectPlanUids(argv = []) {
  const uids = [];
  for (const raw of argv) {
    const arg = String(raw || '').trim();
    if (arg.startsWith('--uid=')) {
      uids.push(extractUidFromLink(arg.split('=')[1].trim()));
    } else if (arg.startsWith('--file=')) {
      try {
        const filePath = arg.split('=')[1].trim();
        const content = await readFile(filePath, 'utf8');
        for (const line of content.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean)) {
          uids.push(extractUidFromLink(line));
        }
      } catch {
        // Missing files produce an empty dry-run plan, matching the Python contract.
      }
    } else if (!arg.startsWith('-')) {
      uids.push(extractUidFromLink(arg));
    }
  }
  return dedupe(uids);
}

export async function buildAicuScrapePlan(payload = {}) {
  const argv = Array.isArray(payload?.argv) ? payload.argv : [];
  const uids = await collectPlanUids(argv);
  const maxPages = parseIntOr(payload?.maxPages ?? payload?.max_pages, 10);
  const pageSize = parseIntOr(payload?.pageSize ?? payload?.page_size, 20);
  const delayBetweenUidsMs = parseIntOr(payload?.delayBetweenUidsMs ?? payload?.delay_between_uids_ms, DELAY_MS * 3);
  return {
    ok: Boolean(uids.length),
    uids,
    requests: uids.map((uid) => ({
      uid,
      commentPages: maxPages,
      danmakuPages: maxPages,
      commentsUrl: `${AICU_COMMENTS_API}?uid=${uid}&pn=1&ps=${pageSize}&mode=0&keyword=`,
      danmakuUrl: `${AICU_DANMAKU_API}?uid=${uid}&pn=1&ps=${pageSize}&keyword=`,
    })),
    summary: {
      uids: uids.length,
      commentPagesPerUid: maxPages,
      danmakuPagesPerUid: maxPages,
      delayBetweenUidsMs,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const planArgs = parsePlanArgs(args);
  if (planArgs.planJson) {
    const payload = await readPlanPayload(planArgs.payloadPath);
    console.log(JSON.stringify(await buildAicuScrapePlan(payload), null, 2));
    return;
  }

  const uids = [];

  for (const arg of args) {
    if (arg.startsWith('--uid=')) {
      uids.push(arg.split('=')[1].trim());
    } else if (arg.startsWith('--file=')) {
      const filePath = arg.split('=')[1].trim();
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const uid = extractUidFromLink(line);
        if (uid) uids.push(uid);
      }
    } else {
      const uid = extractUidFromLink(arg);
      if (uid) uids.push(uid);
    }
  }

  // Deduplicate UIDs
  const uniqueUids = [...new Set(uids)];

  if (uniqueUids.length === 0) {
    console.log('Usage: node scrapeAicuUsers.js --uid=123456 --uid=789012');
    console.log('       node scrapeAicuUsers.js --file=uids.txt');
    console.log('       node scrapeAicuUsers.js 123456 789012');
    console.log('       node scrapeAicuUsers.js https://space.bilibili.com/123456');
    process.exit(1);
  }

  const db = await loadDatabase();
  console.log(`Database has ${Object.keys(db.users).length} users`);
  console.log(`Scraping ${uniqueUids.length} user(s) from aicu.cc...\n`);

  for (const uid of uniqueUids) {
    if (db.users[uid]) {
      console.log(`[skip] ${uid} already in database`);
      continue;
    }

    console.log(`[fetch] ${uid}...`);

    // Fetch comments and danmaku in parallel
    const [comments, danmaku] = await Promise.all([
      scrapeUserComments(uid, 10),
      scrapeUserDanmaku(uid, 10),
    ]);

    if (comments.length === 0 && danmaku.length === 0) {
      console.log(`  No comments or danmaku found`);
      continue;
    }

    const commentText = comments.map((c) => c.message).join('\n');
    const danmakuText = danmaku.map((d) => d.content).join('\n');
    const combinedText = [commentText, danmakuText].filter(Boolean).join('\n');

    db.users[uid] = {
      uid,
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

    console.log(`  Found ${comments.length} comments + ${danmaku.length} danmaku`);
    await saveDatabase(db);
    await wait(DELAY_MS * 3); // Longer delay between UIDs
  }

  console.log(`\nDone. Database now has ${Object.keys(db.users).length} users.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
