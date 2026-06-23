import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidPipelineProgress, compareUidPipelineProgressObjects } from './compareUidPipelineProgress.js';

const SUMMARY = {
  range: { start: 10, end: 14, total: 5 },
  progress: { processed: 3, remaining: 2, completionRatio: 0.6 },
  stats: { success: 1, noComments: 0, noVideos: 0, noUser: 0, trainError: 0, blocked: 2, errors: 1 },
  statusCounts: { success: 1, blocked: 2 },
  userDb: { users: 3, usersInRange: 2 },
};

test('compareUidPipelineProgressObjects reports matching progress summaries', () => {
  const result = compareUidPipelineProgressObjects(
    { ok: true, ...SUMMARY, lastUpdated: 'ignored' },
    { ok: true, ...SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidPipelineProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareUidPipelineProgress({
    payload: { start: 10, end: 14 },
    runJs: async (context) => {
      calls.push({ js: context.start, end: context.end });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.start, end: context.end });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: 10, end: 14 }, { python: 10, end: 14 }]);
});
