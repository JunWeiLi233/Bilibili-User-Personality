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

const bilibili = new Hono();

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
  return c.json(await analyzeUid(payload));
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
