/**
 * DeepSeek API routes — mounted at `/api/deepseek`.
 *
 * Provides endpoints for AI-powered dictionary management: training keyword
 * dictionaries from human annotations, analyzing comments with DeepSeek's
 * speech-act classifier, and querying the current dictionary state.
 *
 * All routes accept JSON bodies and return `{ ok: boolean, error?: string, ...data }`.
 *
 * @module server/routes/deepseek
 */

import { Hono } from 'hono';

import {
  analyzeCommentsWithDeepSeek,
  getDeepSeekConfig,
  readKeywordDictionary,
  trainKeywordDictionary,
} from '../services/deepseekKeywordTrainer.js';
import { findDictionaryEntriesWithSemanticEvidence } from '../services/semanticMatcher.js';
import { scoreComments } from '../services/headlessScorer.js';

const deepseek = new Hono();

/**
 * GET /api/deepseek/config
 *
 * Returns the current DeepSeek API configuration (model, base URL, reasoning
 * effort). Does not expose the API key.
 *
 * Response: { ok: true, model: string, baseUrl: string, reasoningEffort: string }
 */
deepseek.get('/config', async (c) => {
  return c.json(await getDeepSeekConfig());
});

/**
 * GET /api/deepseek/dictionary
 *
 * Returns the full keyword dictionary including all entries with their
 * confidence scores, evidence counts, and family classifications.
 *
 * Response: { ok: true, dictionary: { entries: Array, version: number } }
 */
deepseek.get('/dictionary', async (c) => {
  return c.json({ ok: true, dictionary: await readKeywordDictionary() });
});

/**
 * POST /api/deepseek/analyze-comments
 *
 * Standalone per-comment AI speech-act analysis.
 *
 * **Deferred from main UID search flow** (see .claude/ANALYSIS_TRUNCATION_REPORT.md §5.4):
 * - Uses 6-axis system; UI uses 4-axis Ziegenbein classification
 * - 30-sentence hard cap in buildStandaloneAnalysisInput
 * - Downgrades to v4-flash; synchronous client pipeline would need restructuring
 * - Cost/latency: 5–15s per call × batch size
 *
 * Path forward: align axes → batch → progressive UI → cost budget.
 *
 * Request body: { comments: string[] }
 * Response: { ok: true, analysis: ... }
 */
deepseek.post('/analyze-comments', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await analyzeCommentsWithDeepSeek(payload));
});

/**
 * POST /api/deepseek/score
 *
 * Canonical per-user scorer (headlessScorer.scoreComments) — the single source
 * of truth used by both the eval pipeline and, via this endpoint, the live UI,
 * so the displayed scores can never drift from the validated implementation.
 *
 * The live UI requests calibrate=false to keep the raw 0-100 scale + existing
 * risk bands; the eval path uses the default calibrate=true (calibrated AUC
 * measurement). This supersedes the UI's inlined copy of the same algorithm.
 *
 * Request body: { text: string (required, newline-separated comments),
 *                 name?, uid?, source?, runtimeLexicon?, analysisMode?,
 *                 semanticMatches?, calibrate? }
 * Response: { ok: true, result: { scores, trollIndex, ... } } on success;
 *           { ok: false, error } with 400/500 on bad input / failure.
 */
deepseek.post('/score', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const { text } = payload;
  if (!text || typeof text !== 'string') {
    return c.json({ ok: false, error: 'Missing required field: text (newline-separated comments)' }, 400);
  }
  try {
    const result = scoreComments({
      name: payload.name,
      uid: payload.uid,
      text,
      source: payload.source,
      runtimeLexicon: payload.runtimeLexicon,
      analysisMode: payload.analysisMode,
      semanticMatches: payload.semanticMatches,
      calibrate: payload.calibrate !== false, // default true; UI passes false
    });
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ ok: false, error: `Scoring failed: ${err?.message || String(err)}` }, 500);
  }
});

/**
 * POST /api/deepseek/train-keywords
 *
 * Trains or retrains the keyword dictionary from human-annotated data.
 * Accepts labeled training examples and updates the dictionary entries.
 *
 * Request body: { trainingData?: Array, ... }
 * Response: { ok: true, trained: ... }
 */
deepseek.post('/train-keywords', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  return c.json(await trainKeywordDictionary(payload));
});

/**
 * POST /api/deepseek/semantic-match
 *
 * Semantic match endpoint — **DISABLED** (Phase 5, 2026-06-27).
 *
 * Semantic matching was removed after A/B testing showed 0% unique hits beyond
 * exact substring matching. The @xenova/transformers dependency has been dropped.
 * This endpoint always returns empty matches with telemetry confirming disabled status.
 *
 * Request body: { comments: string[] }
 * Response: { ok: true, _disabled: true, matches: [], _telemetry: {...} }
 */
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
