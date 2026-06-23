import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchBilibiliPlan, compareBatchBilibiliPlanObjects } from './compareBatchBilibiliPlan.js';

const PLAN = {
  input: {
    startUid: 100000,
    endUid: 100005,
  },
  range: {
    startUid: 100003,
    endUid: 100005,
    total: 3,
  },
  resume: {
    lastUid: 100002,
    resumed: true,
  },
  database: {
    users: 3,
  },
  limits: {
    maxVideos: 3,
    maxComments: 50,
    replyPages: 1,
  },
  pacing: {
    delayBetweenRequestsMs: 3000,
    delayBetweenUidsMs: 15000,
    delayAfterRateLimitMs: 60000,
  },
  retry: {
    maxRetries: 3,
    rateLimitCodes: [-799, -412],
    htmlWafDetection: true,
    hasUserAgent: true,
    referer: 'https://www.bilibili.com/',
  },
  browser: {
    command: 'browser-harness',
    script: 'server/scripts/browserGetVideos.py',
    wrapper: 'server/data/_browser_tmp.py',
    timeoutMs: 45000,
    maxVideos: 3,
  },
  sampleRequests: {
    uid: '100003',
    cardUrl: 'https://api.bilibili.com/x/web-interface/card?mid=100003',
    replyUrl: 'https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1',
    wrapperArgv: ['browserGetVideos.py', '100003', '3'],
  },
  progress: {
    completed: 2,
    errors: 1,
  },
};

test('compareBatchBilibiliPlanObjects reports matching batch Bilibili summaries', () => {
  const result = compareBatchBilibiliPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchBilibiliPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchBilibiliPlan({
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
