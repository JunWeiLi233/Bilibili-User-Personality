import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidDiscoveryProgress, compareUidDiscoveryProgressObjects } from './compareUidDiscoveryProgress.js';

const SUMMARY = {
  phase: 'analysis',
  discovery: { videosScanned: 2, videoQueueSize: 7, uidsDiscovered: 3, commentsCollected: 4 },
  analysis: { processed: 3, success: 1, errors: 1, skipped: 1, remaining: 0 },
  comments: { total: 3, averagePerUid: 1, uidsWithComments: 2 },
  stats: { videosScanned: 2, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 1 },
  userDb: { users: 2 },
};

test('compareUidDiscoveryProgressObjects reports matching progress summaries', () => {
  const result = compareUidDiscoveryProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidDiscoveryProgress compares JS-compatible and Python discovery progress reports', async () => {
  const calls = [];
  const result = await compareUidDiscoveryProgress({
    payload: { phase: 'analysis' },
    runJs: async (context) => {
      calls.push({ js: context.dataDir.endsWith('data') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.dataDir.endsWith('data') });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});
