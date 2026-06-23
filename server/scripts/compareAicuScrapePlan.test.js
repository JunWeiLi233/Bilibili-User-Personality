import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareAicuScrapePlan, compareAicuScrapePlanObjects } from './compareAicuScrapePlan.js';

const PLAN = {
  uids: ['123456', '789012'],
  requests: [
    {
      uid: '123456',
      commentPages: 10,
      danmakuPages: 10,
      commentsUrl: 'https://api.aicu.cc/api/v3/search/getreply?uid=123456&pn=1&ps=20&mode=0&keyword=',
      danmakuUrl: 'https://api.aicu.cc/api/v3/search/getvideodm?uid=123456&pn=1&ps=20&keyword=',
    },
  ],
  summary: {
    uids: 2,
    commentPagesPerUid: 10,
    danmakuPagesPerUid: 10,
    delayBetweenUidsMs: 15000,
  },
};

test('compareAicuScrapePlanObjects reports matching scrape plan summaries', () => {
  const result = compareAicuScrapePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuScrapePlan compares JS and Python dry-run scrape plans', async () => {
  const calls = [];
  const result = await compareAicuScrapePlan({
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
