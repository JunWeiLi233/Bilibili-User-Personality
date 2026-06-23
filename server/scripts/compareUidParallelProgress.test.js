import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidParallelProgress, compareUidParallelProgressObjects } from './compareUidParallelProgress.js';

const SUMMARY = {
  worker: { id: 1, totalWorkers: 2, assigned: 2 },
  progress: { processed: 2, remaining: 0, completionRatio: 1 },
  stats: { success: 1, noText: 1, errors: 0 },
  statusCounts: { success: 1, no_text: 1 },
  userDb: { users: 2, assignedUsersInDb: 1 },
};

test('compareUidParallelProgressObjects reports matching progress summaries', () => {
  const result = compareUidParallelProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidParallelProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareUidParallelProgress({
    payload: { worker: 1, workers: 2 },
    runJs: async (context) => {
      calls.push({ js: context.worker, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.worker, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: 1, workers: 2 }, { python: 1, workers: 2 }]);
});
