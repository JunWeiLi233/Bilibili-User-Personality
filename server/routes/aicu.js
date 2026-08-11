import { Hono } from 'hono';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from '../utils/atomicWrite.js';
import { adminAuth } from '../middleware/adminAuth.js';

const aicu = new Hono();

// AICU routes return bulk third-party PII (Bilibili users' comments) and drive
// live scrapes that spend the operator's api.aicu.cc quota. Gate behind
// ADMIN_TOKEN so an exposed server cannot leak PII or be abused anonymously.
aicu.use('*', adminAuth);

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
  // Atomic write (temp -> fsync -> rename -> dir fsync) so a crash mid-write
  // cannot corrupt or zero the 14MB DB. Pair with mutateDatabase below for RMW safety.
  db.lastUpdated = new Date().toISOString();
  await writeJsonAtomic(USER_DB_PATH, db);
}

// In-process mutex (promise chain) that serializes read-modify-write cycles on
// the user DB. Without this, N concurrent /scrape requests for DIFFERENT UIDs
// each load the same snapshot, mutate their own copy, and clobber each other on
// save — last writer wins, the rest silently vanish, and interleaved plain
// writes corrupt the JSON (next load returns {} → full DB wipe). The chain
// makes every RMW wait for the previous to settle; Node is single-threaded so
// in-process serialization is sufficient.
//
// fn mutates `db` in place and returns { value, save }. save=false skips the
// expensive 14MB rewrite (cache hits, not-found). The whole cycle is atomic
// w.r.t. other callers.
let _dbChain = Promise.resolve();
async function mutateDatabase(fn) {
  const run = _dbChain.then(async () => {
    const db = await loadDatabase();
    const { value, save } = await fn(db);
    if (save) await saveDatabase(db);
    return value;
  });
  // Keep the chain alive even if one link rejects, so a single failure can't
  // permanently break all subsequent writes.
  _dbChain = run.catch(() => {});
  return run;
}

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

  // Serialized read-modify-write: the cache check, the network scrape, and the
  // persist all happen inside the database mutex so concurrent /scrape requests
  // for different UIDs cannot clobber each other's writes, and the same UID is
  // scraped exactly once even under a thundering herd (the second caller sees
  // the first's just-persisted cache hit).
  try {
    const result = await mutateDatabase(async (db) => {
      if (db.users[uid]) return { value: { cached: true, user: db.users[uid] }, save: false };

      const [comments, danmaku] = await Promise.all([
        scrapeUserComments(uid, 10),
        scrapeUserDanmaku(uid, 10),
      ]);

      if (comments.length === 0 && danmaku.length === 0) {
        return { value: { notFound: true }, save: false };
      }

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

      db.users[uid] = user; // mutate in place — saveDatabase runs after fn returns
      return { value: { cached: false, user }, save: true };
    });

    if (result.notFound) {
      return c.json({ ok: false, error: 'No comments or danmaku found for this UID' }, 404);
    }
    return c.json({ ok: true, user: result.user, cached: result.cached });
  } catch (err) {
    return c.json({ ok: false, error: 'Scrape failed' }, 500);
  }
});

export default aicu;
