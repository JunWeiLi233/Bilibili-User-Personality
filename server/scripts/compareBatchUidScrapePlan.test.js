import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchUidScrapePlan, compareBatchUidScrapePlanObjects } from './compareBatchUidScrapePlan.js';

const PLAN = {
  discovery: {
    popularPages: 50,
    videosPerPage: 20,
    commentPagesPerVideo: 3,
    scannedBvids: 2,
    uidsDiscovered: 3,
  },
  phase2: {
    processed: 1,
    pending: 2,
    skippableNoText: 1,
    trainable: 1,
    userDbUsers: 2,
  },
  stats: {
    videosScanned: 2,
    uidsFound: 3,
    uidsAnalyzed: 1,
    commentsCollected: 4,
    errors: 0,
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    saveEveryAnalyzed: 10,
  },
  pacing: {
    delayBetweenVideosMs: 2000,
    lockRetryDelayMs: 10000,
    lockMaxRetries: 10,
  },
};

test('compareBatchUidScrapePlanObjects reports matching batch UID scrape summaries', () => {
  const result = compareBatchUidScrapePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchUidScrapePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchUidScrapePlan({
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
