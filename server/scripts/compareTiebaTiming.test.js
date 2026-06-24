import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TIEBA_TIMING_FIXTURES, compareTiebaTiming, compareTiebaTimingObjects } from './compareTiebaTiming.js';

test('compareTiebaTimingObjects compares hard stop timing only', () => {
  const result = compareTiebaTimingObjects({ ok: true, hardStopMs: 19000, ignored: true }, { hardStopMs: 19000, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { hardStopMs: 19000 });
  assert.deepEqual(result.js, { hardStopMs: 19000 });
});

test('compareTiebaTiming compares JS timing with Python timing', async () => {
  const calls = [];
  const result = await compareTiebaTiming({
    payload: { maxQueries: 2, overallTimeoutMs: 4000, blockCooldownMs: 500 },
    runJs: async ({ payload }) => {
      calls.push({ js: payload.maxQueries });
      return { hardStopMs: 19000 };
    },
    runPython: async ({ payload }) => {
      calls.push({ python: payload.maxQueries });
      return { ok: true, hardStopMs: 19000 };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: 2 }, { python: 2 }]);
});

test('compareTiebaTiming exports named timing fixtures', async () => {
  assert.deepEqual(Object.keys(TIEBA_TIMING_FIXTURES), [
    'default-budget',
    'zero-query-fallback',
    'string-and-negative-coercion',
  ]);

  const calls = [];
  const result = await compareTiebaTiming({
    fixtureNames: Object.keys(TIEBA_TIMING_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, maxQueries: context.payload.maxQueries });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, maxQueries: context.payload.maxQueries });
      return { ok: true, ...context.fixture.expected };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-budget', maxQueries: 4 },
    { python: 'default-budget', maxQueries: 4 },
    { js: 'zero-query-fallback', maxQueries: 0 },
    { python: 'zero-query-fallback', maxQueries: 0 },
    { js: 'string-and-negative-coercion', maxQueries: '2' },
    { python: 'string-and-negative-coercion', maxQueries: '2' },
  ]);
});
