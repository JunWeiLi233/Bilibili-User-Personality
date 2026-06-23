import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareUidPipelineWorkerPlan, compareUidPipelineWorkerPlanObjects } from './compareUidPipelineWorkerPlan.js';

const PLAN = {
  range: { start: 10, end: 12, total: 3 },
  progress: { processed: 2, remaining: 1, completionRatio: 0.6667 },
  limits: {
    videosPerUser: 3,
    commentPagesPerVideo: 2,
    commentTextMinChars: 10,
    commentTextLimit: 8000,
  },
  pacing: {
    delayUidMs: 1500,
    delayRequestMs: 500,
    saveEvery: 20,
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    lockRetryDelayMs: 10000,
    lockMaxRetries: 5,
  },
  blockPolicy: {
    blockedCodes: [-799, -352],
    consecutiveBlockThreshold: 3,
    blockBackoffBaseMs: 30000,
    blockBackoffMaxMultiplier: 10,
  },
  stats: { success: 1, noComments: 0, noVideos: 0, noUser: 1, trainError: 0, blocked: 0, errors: 0 },
  userDb: { users: 2, usersInRange: 1 },
};

test('compareUidPipelineWorkerPlanObjects reports matching worker plans', () => {
  const result = compareUidPipelineWorkerPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidPipelineWorkerPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidPipelineWorkerPlan({
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
