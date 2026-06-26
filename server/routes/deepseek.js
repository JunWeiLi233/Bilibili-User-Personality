import { Hono } from 'hono';

import {
  analyzeCommentsWithDeepSeek,
  getDeepSeekConfig,
  readKeywordDictionary,
  trainKeywordDictionary,
} from '../services/deepseekKeywordTrainer.js';
import {
  buildTermEmbeddings,
  chunkCommentText,
  matchCommentToTerms,
} from '../services/semanticMatcher.js';

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

deepseek.post('/semantic-match', async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({}));
    const { comments = [], threshold } = payload;
    if (!comments.length) return c.json({ ok: true, matches: [] });

    const dictionary = await readKeywordDictionary();
    const terms = (dictionary?.families
      ? Object.values(dictionary.families).flat()
      : (dictionary?.entries || []));
    if (!terms.length) return c.json({ ok: true, matches: [] });

    const termEmbeddings = await buildTermEmbeddings({ entries: terms }, {
      cachePath: 'server/semanticTermEmbeddings.json',
    });

    const allMatches = [];
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      if (!comment) { allMatches.push([]); continue; }
      const chunks = chunkCommentText(comment);
      const matches = await matchCommentToTerms(chunks, termEmbeddings, threshold ? Number(threshold) : undefined);
      allMatches.push(matches);
    }

    return c.json({ ok: true, matches: allMatches });
  } catch (error) {
    return c.json({ ok: false, matches: [], error: error.message });
  }
});

export default deepseek;
