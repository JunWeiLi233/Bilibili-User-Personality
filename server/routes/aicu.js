import { Hono } from 'hono';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const AICU_COMMENTS_API = 'https://api.aicu.cc/api/v3/search/getreply';
const AICU_DANMAKU_API = 'https://api.aicu.cc/api/v3/search/getvideodm';
const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const DELAY_MS = 1500;
const MAX_CONSECUTIVE_RETRIES = 5;
const RETRY_BASE_MS = 10000;

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
  let consecutiveRetries = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuComments(uid, page);
      if (data.code !== 0 || !data.data?.replies?.length) break;
      allComments.push(...data.data.replies);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      consecutiveRetries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        consecutiveRetries += 1;
        if (consecutiveRetries > MAX_CONSECUTIVE_RETRIES) break;
        await wait(RETRY_BASE_MS * consecutiveRetries);
        page--;
        continue;
      }
      break;
    }
  }
  return allComments;
}

async function scrapeUserDanmaku(uid, maxPages = 10) {
  const allDanmaku = [];
  let consecutiveRetries = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuDanmaku(uid, page);
      if (data.code !== 0 || !data.data?.videodmlist?.length) break;
      allDanmaku.push(...data.data.videodmlist);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      consecutiveRetries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        consecutiveRetries += 1;
        if (consecutiveRetries > MAX_CONSECUTIVE_RETRIES) break;
        await wait(RETRY_BASE_MS * consecutiveRetries);
        page--;
        continue;
      }
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

const aicu = new Hono();

aicu.get('/users', async (c) => {
  const db = await loadDatabase();
  const users = Object.values(db.users).map((u) => ({
    uid: u.uid,
    commentCount: u.commentCount,
    danmakuCount: u.danmakuCount || 0,
    scrapedAt: u.scrapedAt,
  }));
  return c.json({ ok: true, users, lastUpdated: db.lastUpdated });
});

aicu.get('/users/:uid', async (c) => {
  const uid = c.req.param('uid');
  const db = await loadDatabase();
  const user = db.users[uid];
  if (!user) return c.json({ ok: false, error: 'User not found' }, 404);
  return c.json({ ok: true, user });
});

aicu.post('/scrape', async (c) => {
  const { uid } = await c.req.json().catch(() => ({}));
  if (!uid || !/^\d+$/.test(String(uid))) {
    return c.json({ ok: false, error: 'Valid UID required' }, 400);
  }

  const db = await loadDatabase();
  if (db.users[uid]) {
    return c.json({ ok: true, user: db.users[uid], cached: true });
  }

  // Fetch comments and danmaku in parallel
  const [comments, danmaku] = await Promise.all([
    scrapeUserComments(uid, 10),
    scrapeUserDanmaku(uid, 10),
  ]);

  if (comments.length === 0 && danmaku.length === 0) {
    return c.json({ ok: false, error: 'No comments or danmaku found for this UID' }, 404);
  }

  // Build combined text for analysis
  const commentText = comments.map((item) => item.message).join('\n');
  const danmakuText = danmaku.map((d) => d.content).join('\n');
  const combinedText = [commentText, danmakuText].filter(Boolean).join('\n');

  const user = {
    uid,
    commentCount: comments.length,
    danmakuCount: danmaku.length,
    commentText,
    danmakuText,
    combinedText,
    comments: comments.map((item) => ({
      rpid: item.rpid,
      message: item.message,
      time: item.time,
      rank: item.rank,
      oid: item.dyn?.oid,
      type: item.dyn?.type,
    })),
    danmaku: danmaku.map((d) => ({
      id: d.id,
      content: d.content,
      time: d.ctime,
      oid: d.oid,
    })),
    scrapedAt: new Date().toISOString(),
  };

  db.users[uid] = user;
  await saveDatabase(db);

  return c.json({ ok: true, user, cached: false });
});

export default aicu;
