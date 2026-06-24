import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDirectProbePlan, compareDirectProbePlanObjects } from './compareDirectProbePlan.js';

const PLAN = {
  nextReplyCursor: 1,
  viewUrl: 'https://api.bilibili.com/x/web-interface/view?aid=116663559131570',
  replyUrl: 'https://api.bilibili.com/x/v2/reply/main?type=1&oid=116663559131570&mode=3&next=0&ps=20',
  replyPageUrl: 'https://api.bilibili.com/x/v2/reply?type=1&oid=116663559131570&sort=2&pn=1&ps=20',
  replyThreadUrl: 'https://api.bilibili.com/x/v2/reply/reply?type=1&oid=116663559131570&root=301234384593&pn=1&ps=20',
  searchUrls: ['https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=x&page=1&page_size=20'],
  syntheticCookie: 'buvid3=88888888-8888-8888-8888-8888888888888infoc',
};

test('compareDirectProbePlanObjects reports matching plan summary only', () => {
  const result = compareDirectProbePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareDirectProbePlan compares JS and Python dry-run plan payloads', async () => {
  const calls = [];
  const result = await compareDirectProbePlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...PLAN };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...PLAN };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareDirectProbePlan delegates saved JS plan comparison to Python contract', async () => {
  let compareContext;
  const result = await compareDirectProbePlan({
    runJs: async () => ({ ok: true, ...PLAN }),
    runPython: async () => ({ ok: true, ...PLAN }),
    runCompare: async (context) => {
      compareContext = context;
      return {
        ok: true,
        mismatches: [],
        python: PLAN,
        js: PLAN,
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsPlanPath.endsWith('js-plan.json'), true);
  assert.deepEqual(compareContext.jsPlan, { ok: true, ...PLAN });
  assert.deepEqual(compareContext.pythonPlan, { ok: true, ...PLAN });
});
