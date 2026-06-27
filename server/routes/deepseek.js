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
  const tStart = Date.now();
  try {
    const payload = await c.req.json().catch(() => ({}));
    const { comments = [], threshold } = payload;
    if (!comments.length) return c.json({ ok: true, matches: [] });

    const tDict = Date.now();
    const dictionary = await readKeywordDictionary();
    const terms = (dictionary?.families
      ? Object.values(dictionary.families).flat()
      : (dictionary?.entries || []));
    if (!terms.length) return c.json({ ok: true, matches: [] });

    const tEmbed = Date.now();
    const termEmbeddings = await buildTermEmbeddings({ entries: terms }, {
      cachePath: 'server/semanticTermEmbeddings.json',
    });
    const embedMs = Date.now() - tEmbed;

    const allMatches = [];
    let commentsWithMatches = 0;
    let totalTermMatches = 0;
    const tMatch = Date.now();
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      if (!comment) { allMatches.push([]); continue; }
      const chunks = chunkCommentText(comment);
      const matches = await matchCommentToTerms(chunks, termEmbeddings, threshold ? Number(threshold) : undefined);
      allMatches.push(matches);
      if (matches.length > 0) {
        commentsWithMatches += 1;
        totalTermMatches += matches.length;
      }
    }
    const matchMs = Date.now() - tMatch;
    const totalMs = Date.now() - tStart;

    // Telemetry: log semantic match request summary
    console.log(
      `[semantic-match] ${comments.length} comments, ${commentsWithMatches} hits (${totalTermMatches} term matches), ` +
      `dict=${Date.now() - tDict}ms embed=${embedMs}ms match=${matchMs}ms total=${totalMs}ms`,
    );

    return c.json({
      ok: true,
      matches: allMatches,
      _telemetry: {
        commentsTotal: comments.length,
        commentsWithMatches,
        totalTermMatches,
        hitRate: comments.length ? Number((commentsWithMatches / comments.length).toFixed(3)) : 0,
        avgMatchesPerHitComment: commentsWithMatches ? Number((totalTermMatches / commentsWithMatches).toFixed(1)) : 0,
        timingMs: { total: totalMs, dictionaryLoad: Date.now() - tDict - embedMs - matchMs, embeddingBuild: embedMs, matching: matchMs },
      },
    });
  } catch (error) {
    console.warn(`[semantic-match] failed after ${Date.now() - tStart}ms:`, error.message);
    return c.json({ ok: false, matches: [], error: error.message });
  }
});

export default deepseek;
