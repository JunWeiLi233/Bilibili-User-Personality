import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBatchScraperLauncherPlan, compareBatchScraperLauncherPlanObjects } from './compareBatchScraperLauncherPlan.js';

const SUMMARY = {
  workers: [
    { start: 1, end: 20000, progressFile: 'batch-uid-progress-1-20000.json' },
    { start: 20001, end: 40000, progressFile: 'batch-uid-progress-20001-40000.json' },
    { start: 40001, end: 60000, progressFile: 'batch-uid-progress-40001-60000.json' },
    { start: 60001, end: 80000, progressFile: 'batch-uid-progress-60001-80000.json' },
    { start: 80001, end: 100000, progressFile: 'batch-uid-progress-80001-100000.json' },
  ],
  summary: {
    workers: 5,
    totalStart: 1,
    totalEnd: 100000,
    totalUids: 100000,
  },
};

test('compareBatchScraperLauncherPlanObjects reports matching launcher summaries', () => {
  const result = compareBatchScraperLauncherPlanObjects({ ok: true, ...SUMMARY, ignored: true }, { ok: true, ...SUMMARY, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareBatchScraperLauncherPlan compares JS and Python launch plans', async () => {
  const calls = [];
  const result = await compareBatchScraperLauncherPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});
