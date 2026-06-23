import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDeepSeekAnalyzeFixture } from './compareDeepSeekAnalyzeFixture.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
};

test('compareDeepSeekAnalyzeFixture compares full JS command fixture output to Python normalization', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeFixture({
    runJsFixture: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonNormalization: async (payload) => {
      calls.push({ python: payload });
      return NORMALIZED;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js, NORMALIZED);
  assert.deepEqual(result.python, NORMALIZED);
  assert.equal(calls.length, 2);
});
