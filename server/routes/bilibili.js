/**
 * Bilibili API routes — mounted at `/api/bilibili`.
 *
 * Provides endpoints for analyzing a single user (by UID/mid) and for
 * searching comments across a set of video links for keyword matches.
 *
 * All routes accept JSON bodies and return JSON responses. The response
 * shape follows `{ ok: boolean, error?: string, ...data }`.
 *
 * @module server/routes/bilibili
 */

import { Hono } from 'hono';

import { analyzeUid } from '../services/bilibiliCrawler.js';
import { searchVideoKeywords } from '../services/videoKeywordSearch.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { singleFlight } from '../utils/singleFlight.js';

const bilibili = new Hono();

// Both routes drive the operator's authenticated Bilibili session (and can be
// used to spend the operator's account quota). Gate behind ADMIN_TOKEN so an
// exposed server cannot be abused by anonymous callers.
bilibili.use('*', adminAuth);

/**
 * In-flight coalescer for analyzeUid, keyed by UID + cookie.
 *
 * When N web users search the SAME UID concurrently, only ONE underlying
 * analyzeUid crawl runs against Bilibili — the rest await the same promise and
 * receive the same result. This removes the N× request multiplier that is the
 * leading cause of Bilibili IP blocks under multi-user load (AGENTS.md §8).
 *
 * A 30s post-resolution TTL keeps a finished result hot briefly so a fast
 * follow-up (refresh, double-click) still coalesces; the crawler's own LRU
 * cache handles longer-term freshness. The coalescer does NOT bypass or weaken
 * the crawler's throttle, token bucket, or block cooldown — it only removes
 * redundant duplicate work on top of those protection layers. Composes cleanly
 * with the adminAuth gate above (auth runs first, then the coalesced crawl).
 */
const COALESCE_TTL_MS = 30_000;
const analyzeUidCoalesced = singleFlight(
  (payload, ...rest) => analyzeUid(payload, ...rest),
  {
    key: (payload) => {
      const uid = String(payload?.uid || '').trim();
      // Per-cookie namespacing: an authenticated crawl may return different data
      // than an anonymous one, so callers with different cookies must not share.
      const cookie = String(payload?.bilibiliCookie || payload?.cookie || '').trim().slice(0, 16);
      return `${uid}\u0001${cookie}`;
    },
    ttlMs: COALESCE_TTL_MS,
  },
);

/**
 * POST /api/bilibili/analyze-uid
 *
 * Analyze a single Bilibili user by their numeric mid (UID).
 * Fetches the userʼs recent comments, replies, and danmaku,
 * then scores them against the keyword dictionary.
 *
 * Request body (JSON):
 *   { uid: string }  — numeric Bilibili mid (e.g. "123456")
 *   Optional: { bilibiliCookie?: string, cookie?: string }
 *
 * Response (JSON):
 *   On success: { ok: true, ...analysis result }
 *   On failure: { ok: false, error: string }
 */
bilibili.post('/analyze-uid', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  // Coalesce concurrent identical-UID searches so multi-user load doesn't
  // multiply Bilibili requests (IP-block protection, AGENTS.md §8).
  return c.json(await analyzeUidCoalesced(payload));
});

/**
 * POST /api/bilibili/video-keywords
 *
 * Search for keyword matches across a set of video comment sections.
 * Accepts a list of video links (BV ids) and returns evidence hits
 * from the comment corpus.
 *
 * Request body (JSON):
 *   { videoLinks?: string | string[] }  — BV link(s) to search
 *   Optional: { bilibiliCookie?: string, cookie?: string, abortSignal?: AbortSignal }
 *
 * Response (JSON):
 *   { ok: boolean, results?: Array, error?: string }
 */
bilibili.post('/video-keywords', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await searchVideoKeywords(payload));
});

export default bilibili;
