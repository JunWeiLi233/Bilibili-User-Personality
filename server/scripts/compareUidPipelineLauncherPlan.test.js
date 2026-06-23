import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidPipelineLauncherPlan, compareUidPipelineLauncherPlanObjects } from './compareUidPipelineLauncherPlan.js';

const SUMMARY = {
  workers: [
    { start: 1, end: 20000, progressFile: 'uid-pipeline-1-20000.json' },
    { start: 20001, end: 40000, progressFile: 'uid-pipeline-20001-40000.json' },
    { start: 40001, end: 60000, progressFile: 'uid-pipeline-40001-60000.json' },
    { start: 60001, end: 80000, progressFile: 'uid-pipeline-60001-80000.json' },
    { start: 80001, end: 100000, progressFile: 'uid-pipeline-80001-100000.json' },
  ],
};

test('compareUidPipelineLauncherPlanObjects reports matching launcher state workers', () => {
  const result = compareUidPipelineLauncherPlanObjects(
    { ok: true, startedAt: '', state: { startedAt: '', ...SUMMARY }, ignored: true },
    { ok: true, startedAt: 'dynamic', ...SUMMARY, ignored: false },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidPipelineLauncherPlan compares JS and Python launch plans', async () => {
  const calls = [];
  const result = await compareUidPipelineLauncherPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, state: { startedAt: '', ...SUMMARY } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});
