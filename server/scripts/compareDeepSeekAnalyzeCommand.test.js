import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareDeepSeekAnalyzeCommand,
  compareDeepSeekAnalyzeCommandObjects,
} from './compareDeepSeekAnalyzeCommand.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
};

test('compareDeepSeekAnalyzeCommandObjects reports fixture command parity', () => {
  const result = compareDeepSeekAnalyzeCommandObjects(NORMALIZED, { ...NORMALIZED, ignored: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, NORMALIZED);
  assert.deepEqual(result.js, NORMALIZED);
});

test('compareDeepSeekAnalyzeCommand compares JS and Python fixture commands', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeCommand({
    runJsCommand: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonCommand: async (payload) => {
      calls.push({ python: payload });
      return NORMALIZED;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});
