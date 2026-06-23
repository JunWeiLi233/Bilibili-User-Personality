import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchUidRangePlan, compareBatchUidRangePlanObjects } from './compareBatchUidRangePlan.js';

const PLAN = {
  input: {
    start: 200000,
    end: 300000,
    pages: 80,
    phase2Only: true,
  },
  phase1: {
    enabled: false,
    scannedBvids: 2,
    maxPages: 80,
    popularPageSize: 20,
    commentPagesPerVideo: 3,
  },
  phase2: {
    targetUids: 2,
    processed: 2,
    remaining: 0,
    userDbUsers: 1,
  },
  stats: {
    videosScanned: 2,
    uidsFound: 4,
    targetUidsFound: 2,
    commentsCollected: 4,
    analyzed: 1,
    skipped: 1,
    errors: 0,
  },
  pacing: {
    delayBetweenVideosMs: 2000,
    delayBetweenUidsMs: 1500,
    lockRetryDelayMs: 3000,
    lockMaxRetries: 10,
    saveInterval: 5,
  },
};

test('compareBatchUidRangePlanObjects reports matching batch UID range summaries', () => {
  const result = compareBatchUidRangePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchUidRangePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchUidRangePlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...PLAN };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...PLAN };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});
