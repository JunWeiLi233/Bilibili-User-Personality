import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidParallelPlan, compareUidParallelPlanObjects } from './compareUidParallelPlan.js';

const PLAN = {
  worker: { id: 1, totalWorkers: 3, assigned: 2 },
  assignment: {
    assignedUids: ['102', '105'],
    alreadyProcessed: 1,
    pending: 1,
    trainable: 1,
    skippableNoText: 0,
  },
  training: { multiagent: true, existingTermsOnly: false, commentTextLimit: 5000, saveEvery: 20 },
  pacing: {
    lockRetryDelayMs: 3000,
    lockRetryJitterMs: 2000,
    lockMaxRetries: 15,
    staleLockRemovalAfterAttempt: 8,
  },
  stats: { success: 1, noText: 0, errors: 0 },
  userDb: { users: 2, assignedUsersInDb: 1 },
};

test('compareUidParallelPlanObjects reports matching parallel analyzer plans', () => {
  const result = compareUidParallelPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidParallelPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidParallelPlan({
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
