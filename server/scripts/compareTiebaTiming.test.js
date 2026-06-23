import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareTiebaTiming, compareTiebaTimingObjects } from './compareTiebaTiming.js';

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
