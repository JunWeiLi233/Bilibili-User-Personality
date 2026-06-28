import { Hono } from 'hono';

import {
  analyzeCommentsWithDeepSeek,
  getDeepSeekConfig,
  readKeywordDictionary,
  trainKeywordDictionary,
} from '../services/deepseekKeywordTrainer.js';
import { findDictionaryEntriesWithSemanticEvidence } from '../services/semanticMatcher.js';

const deepseek = new Hono();

deepseek.get('/config', async (c) => {
  return c.json(await getDeepSeekConfig());
});

deepseek.get('/dictionary', async (c) => {
  return c.json({ ok: true, dictionary: await readKeywordDictionary() });
});

// Standalone per-comment AI speech-act analysis.
// NOT wired into the main UID search flow (src/main.jsx:fetchUidComments).
// See .claude/ANALYSIS_TRUNCATION_REPORT.md §5.4 for deferral rationale:
// - Uses 6-axis system; UI uses 4-axis Ziegenbein classification
// - 30-sentence hard cap in buildStandaloneAnalysisInput (L4174)
// - Downgrades to v4-flash; synchronous client pipeline would need restructuring
// - Cost/latency: 5-15s per call × batch size
// Path forward: align axes → batch → progressive UI → cost budget.
deepseek.post('/analyze-comments', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await analyzeCommentsWithDeepSeek(payload));
});

deepseek.post('/train-keywords', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await trainKeywordDictionary(payload));
});

// Semantic match endpoint — DISABLED (Phase 5, 2026-06-27).
// Semantic matching was removed after A/B testing showed 0% unique hits beyond
// exact substring matching. The @xenova/transformers dependency has been dropped.
// This endpoint always returns empty matches with telemetry confirming disabled status.
deepseek.post('/semantic-match', async (c) => {
  const t0 = performance.now();
  const payload = await c.req.json().catch(() => ({}));
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const t1 = performance.now();
  const dictionary = await readKeywordDictionary();
  const t2 = performance.now();
  const matches = await Promise.all(comments.map((comment) =>
    findDictionaryEntriesWithSemanticEvidence(dictionary, String(comment || ''))));
  const t3 = performance.now();

  // Telemetry for observability
  const commentsWithMatches = matches.filter((m) => m.length > 0).length;
  const totalTermMatches = matches.reduce((sum, m) => sum + m.length, 0);
  const hitRate = comments.length > 0 ? commentsWithMatches / comments.length : 0;

  return c.json({
    ok: true,
    _disabled: true,
    _disabledReason: 'Semantic matching removed (Phase 5, 2026-06-27). A/B test: 0% unique hits beyond keyword matching.',
    matches,
    _telemetry: {
      commentsTotal: comments.length,
      commentsWithMatches,
      totalTermMatches,
      hitRate: Math.round(hitRate * 1000) / 1000,
      avgMatchesPerHitComment: commentsWithMatches > 0
        ? Math.round((totalTermMatches / commentsWithMatches) * 100) / 100
        : 0,
      timingMs: {
        total: Math.round((t3 - t0) * 100) / 100,
        dictionaryLoad: Math.round((t2 - t1) * 100) / 100,
        matching: Math.round((t3 - t2) * 100) / 100,
      },
    },
  });
});



export default deepseek;
