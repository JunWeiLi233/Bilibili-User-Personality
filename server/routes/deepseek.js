import { Hono } from 'hono';

import {
  analyzeCommentsWithDeepSeek,
  getDeepSeekConfig,
  readKeywordDictionary,
  trainKeywordDictionary,
} from '../services/deepseekKeywordTrainer.js';

const deepseek = new Hono();

deepseek.get('/config', async (c) => {
  return c.json(await getDeepSeekConfig());
});

deepseek.get('/dictionary', async (c) => {
  return c.json({ ok: true, dictionary: await readKeywordDictionary() });
});

deepseek.post('/analyze-comments', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await analyzeCommentsWithDeepSeek(payload));
});

deepseek.post('/train-keywords', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await trainKeywordDictionary(payload));
});

export default deepseek;
