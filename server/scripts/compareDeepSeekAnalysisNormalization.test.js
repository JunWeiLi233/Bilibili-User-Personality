import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareDeepSeekAnalysisNormalization,
  compareNormalizationObjects,
} from './compareDeepSeekAnalysisNormalization.js';

const DEFAULT_PAYLOAD = { text: '狗头保命[doge]\n建议查查资料再说' };
const DEFAULT_ANALYSIS = {
  parsed: {
    axes: [
      { axis: 'attack', score: 120, evidence: ['狗头保命[doge]'], reasoning: 'meme tone' },
      { axis: 'evidence', score: -5, evidence: [], reasoning: 'missing' },
    ],
    sentenceAnalyses: [
      {
        quote: '狗头保命',
        speechAct: '玩梗',
        target: '自我保护',
        stance: '反讽',
        contextRole: '语气标记',
        risk: 'low',
        axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 2, reasoning: 'too strong' }],
        reasoning: 'emoji matters',
      },
    ],
    overall: { riskBand: '低风险讨论型', summary: 'emoji softens tone' },
    confidence: 2,
  },
};

const DEFAULT_NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  retriedCompactPrompt: false,
  axes: [],
  sentenceAnalyses: [],
  overall: { riskBand: '低风险讨论型', summary: 'emoji softens tone' },
  confidence: 0.92,
  raw: '{}',
};

test('compareDeepSeekAnalysisNormalization reports matching JS and Python normalized contracts', async () => {
  const result = await compareDeepSeekAnalysisNormalization({
    payload: DEFAULT_PAYLOAD,
    analysis: DEFAULT_ANALYSIS,
    runPythonNormalization: async () => DEFAULT_NORMALIZED,
    normalizeJs: () => DEFAULT_NORMALIZED,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js, DEFAULT_NORMALIZED);
  assert.deepEqual(result.python, DEFAULT_NORMALIZED);
});

test('compareNormalizationObjects reports normalized output drift by result key', () => {
  const result = compareNormalizationObjects(
    { ok: true, confidence: 0.92, axes: [{ axis: 'attack', score: 100 }] },
    { ok: true, confidence: 0.7, axes: [{ axis: 'attack', score: 50 }] },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'axes', python: [{ axis: 'attack', score: 100 }], js: [{ axis: 'attack', score: 50 }] },
    { key: 'confidence', python: 0.92, js: 0.7 },
  ]);
});
