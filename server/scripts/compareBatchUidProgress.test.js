import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchUidProgress, compareBatchUidProgressObjects } from './compareBatchUidProgress.js';

const SUMMARY = {
  discovery: { videosScanned: 3, uidsDiscovered: 3, commentsCollected: 4 },
  phase2: { processed: 3, success: 1, errors: 1, skipped: 1, remaining: 0 },
  comments: { total: 3, averagePerUid: 1, uidsWithComments: 2 },
  stats: { videosScanned: 3, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 2 },
};

test('compareBatchUidProgressObjects reports matching progress summaries', () => {
  const result = compareBatchUidProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareBatchUidProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareBatchUidProgress({
    runJs: async (context) => {
      calls.push({ js: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});
