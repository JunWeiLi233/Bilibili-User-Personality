import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareAicuBrowserBatchPlan, compareAicuBrowserBatchPlanObjects } from './compareAicuBrowserBatchPlan.js';

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
  browser: {
    command: 'browser-harness',
    script: 'server/scripts/browserScrapeAicu.py',
    wrapper: 'server/data/_browser_aicu_tmp.py',
    timeoutMs: 120000,
    maxPages: 3,
  },
  pacing: {
    delayBetweenUidsMs: 5000,
    saveEveryAttempts: 10,
  },
  sampleInvocation: {
    uid: '100003',
    wrapperArgv: ['browserScrapeAicu.py', '100003', '3'],
    exec: 'browser-harness -c "exec(open(\'server/data/_browser_aicu_tmp.py\').read())"',
  },
};

test('compareAicuBrowserBatchPlanObjects reports matching browser batch plan summaries', () => {
  const result = compareAicuBrowserBatchPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuBrowserBatchPlan compares JS and Python dry-run browser batch plans', async () => {
  const calls = [];
  const result = await compareAicuBrowserBatchPlan({
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
