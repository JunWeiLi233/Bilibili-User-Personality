import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDeepSeekAnalyzeMockRuntime } from './compareDeepSeekAnalyzeMockRuntime.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
  raw: '{}',
};

test('compareDeepSeekAnalyzeMockRuntime compares mocked service runtime to Python normalization', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async (payload) => {
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

test('compareDeepSeekAnalyzeMockRuntime passes mock analysis through the Python command runtime', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonCommand: async (payload) => {
      calls.push({ pythonCommand: payload });
      return NORMALIZED;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[1])[0], 'pythonCommand');
});
