import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareAicuBatchPlan, compareAicuBatchPlanObjects } from './compareAicuBatchPlan.js';

const PLAN = {
  range: {
    requestedStart: 100000,
    effectiveStart: 100003,
    end: 100005,
    total: 3,
  },
  progress: {
    lastUid: 100002,
    completed: 2,
    errors: 1,
  },
  database: {
    users: 3,
    existingInEffectiveRange: 1,
  },
  limits: {
    maxPages: 3,
    pageSize: 20,
    saveEveryAttempts: 5,
  },
  pacing: {
    delayBetweenPagesMs: 10000,
    delayBetweenUidsMs: 20000,
    delayAfterWafMs: 120000,
  },
  retry: {
    maxRetries: 3,
    wafStatuses: [429, 468, 1015],
    headers: {
      accept: 'application/json',
      referer: 'https://www.aicu.cc/',
      hasUserAgent: true,
    },
  },
  sampleRequests: {
    uid: '100003',
    commentsUrl: 'https://api.aicu.cc/api/v3/search/getreply?uid=100003&pn=1&ps=20&mode=0&keyword=',
    danmakuUrl: 'https://api.aicu.cc/api/v3/search/getvideodm?uid=100003&pn=1&ps=20&keyword=',
  },
};

test('compareAicuBatchPlanObjects reports matching batch plan summaries', () => {
  const result = compareAicuBatchPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuBatchPlan compares JS and Python dry-run batch plans', async () => {
  const calls = [];
  const result = await compareAicuBatchPlan({
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
