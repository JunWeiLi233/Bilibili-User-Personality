import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidRangeProgress, compareUidRangeProgressObjects } from './compareUidRangeProgress.js';

const SUMMARY = {
  range: { start: 200000, end: 300000 },
  discovery: { videosScanned: 2, uidsDiscovered: 4, targetUidsDiscovered: 2, commentsCollected: 5 },
  phase2: { processed: 2, success: 1, errors: 1, skipped: 1, remaining: 0 },
  comments: { totalForTargetUids: 3, averagePerTargetUid: 1.5 },
};

test('compareUidRangeProgressObjects reports matching progress summaries', () => {
  const result = compareUidRangeProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidRangeProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareUidRangeProgress({
    payload: { start: 200000, end: 300000 },
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
  assert.deepEqual(calls, [{ js: 200000, end: 300000 }, { python: 200000, end: 300000 }]);
});
