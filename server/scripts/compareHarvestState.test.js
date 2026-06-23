import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareHarvestState, compareHarvestStateObjects } from './compareHarvestState.js';

const TERM_ATTEMPTS = {
  '5rWL6K-V': {
    key: '5rWL6K-V',
    term: '测试',
    family: 'attack',
    attempts: 1,
    successfulAttempts: 1,
    lastQuery: '测试 评论区',
  },
};

test('compareHarvestStateObjects reports matching state summaries', () => {
  const result = compareHarvestStateObjects(
    { ok: true, termAttempts: TERM_ATTEMPTS, ignored: true },
    { ok: true, termAttempts: TERM_ATTEMPTS },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { termAttempts: TERM_ATTEMPTS });
  assert.deepEqual(result.js, { termAttempts: TERM_ATTEMPTS });
});

test('compareHarvestState compares JS-compatible and Python harvest state results', async () => {
  const calls = [];
  const result = await compareHarvestState({
    payload: { mode: 'default', planItem: { term: '测试', query: '测试 评论区' }, result: { ok: true } },
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});
