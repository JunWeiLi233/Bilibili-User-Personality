import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchPopularPlan, compareBatchPopularPlanObjects } from './compareBatchPopularPlan.js';

const PLAN = {
  input: {
    maxPages: 8,
  },
  range: {
    startPage: 4,
    maxPages: 8,
    remainingPages: 5,
  },
  progress: {
    pagesScanned: 3,
    videosScanned: 20,
    scraped: 4,
  },
  database: {
    users: 2,
  },
  limits: {
    popularPageSize: 20,
    replyPagesPerVideo: 10,
    replyPageSize: 20,
  },
  pacing: {
    delayMs: 3000,
    delayAfterLimitMs: 60000,
    maxRetries: 5,
  },
  retry: {
    rateLimitCodes: [-799, -412],
    htmlWafDetection: true,
    hasUserAgent: true,
    referer: 'https://www.bilibili.com/',
  },
  collection: {
    storesTopLevelReplies: true,
    storesNestedReplies: true,
    dedupesByRpid: true,
    updatesCombinedTextFromComments: true,
  },
  sampleRequests: {
    popularUrl: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=4',
    replyUrl: 'https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1',
  },
};

test('compareBatchPopularPlanObjects reports matching batch popular summaries', () => {
  const result = compareBatchPopularPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchPopularPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchPopularPlan({
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
