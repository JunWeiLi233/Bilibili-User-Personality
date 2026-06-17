import { Hono } from 'hono';

import { analyzeUid } from '../services/bilibiliCrawler.js';
import { searchVideoKeywords } from '../services/videoKeywordSearch.js';

const bilibili = new Hono();

bilibili.post('/analyze-uid', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await analyzeUid(payload));
});

bilibili.post('/video-keywords', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await searchVideoKeywords(payload));
});

export default bilibili;
