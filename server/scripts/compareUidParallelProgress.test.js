import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UID_PARALLEL_PROGRESS_FIXTURES,
  compareUidParallelProgress,
  compareUidParallelProgressObjects,
} from './compareUidParallelProgress.js';

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

test('compareUidParallelProgress exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(UID_PARALLEL_PROGRESS_FIXTURES), ['default-progress', 'corrupt-inputs']);

  const contexts = [];
  const result = await compareUidParallelProgress({
    fixtureNames: Object.keys(UID_PARALLEL_PROGRESS_FIXTURES),
    runJs: async (context) => {
      contexts.push({ js: context.fixture.name, worker: context.worker, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      contexts.push({ python: context.fixture.name, worker: context.worker, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-progress', 'corrupt-inputs']);
  assert.deepEqual(contexts, [
    { js: 'default-progress', worker: 1, workers: 2 },
    { python: 'default-progress', worker: 1, workers: 2 },
    { js: 'corrupt-inputs', worker: 1, workers: 2 },
    { python: 'corrupt-inputs', worker: 1, workers: 2 },
  ]);
});
