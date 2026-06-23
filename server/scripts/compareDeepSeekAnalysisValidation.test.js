import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareDeepSeekAnalysisValidation,
  compareValidationObjects,
} from './compareDeepSeekAnalysisValidation.js';

const DEFAULT_PAYLOAD = {
  comments: ['狗头保命[doge]', '建议查查资料再说'],
};

const DEFAULT_ANALYSIS = {
  parsed: {
    sentenceAnalyses: [{ quote: '狗头保命[doge]', risk: 'low' }],
    axes: [{ axis: 'evidence', score: 60, evidence: ['查查资料'] }],
  },
};

const DEFAULT_REPORT = {
  ok: true,
  summary: {
    sourceSentences: 2,
    sentenceAnalyses: 1,
    axes: 1,
    unsupportedQuotes: 0,
    unsupportedAxisEvidence: 0,
  },
  unsupportedQuotes: [],
  unsupportedAxisEvidence: [],
};

test('compareDeepSeekAnalysisValidation reports matching JS and Python validation contracts', async () => {
  const result = await compareDeepSeekAnalysisValidation({
    payload: DEFAULT_PAYLOAD,
    analysis: DEFAULT_ANALYSIS,
    runPythonValidation: async () => DEFAULT_REPORT,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js, DEFAULT_REPORT);
  assert.deepEqual(result.python, DEFAULT_REPORT);
});

test('compareValidationObjects reports quote validation drift using Python/JS keys', () => {
  const result = compareValidationObjects(
    {
      ok: false,
      summary: { unsupportedQuotes: 1 },
      unsupportedQuotes: [{ path: 'sentenceAnalyses[0].quote', quote: '幻觉引用' }],
      unsupportedAxisEvidence: [],
    },
    {
      ok: true,
      summary: { unsupportedQuotes: 0 },
      unsupportedQuotes: [],
      unsupportedAxisEvidence: [],
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'ok', python: false, js: true },
    { key: 'summary', python: { unsupportedQuotes: 1 }, js: { unsupportedQuotes: 0 } },
    {
      key: 'unsupportedQuotes',
      python: [{ path: 'sentenceAnalyses[0].quote', quote: '幻觉引用' }],
      js: [],
    },
  ]);
});
