import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareNearTargetResolvePlan,
  compareNearTargetResolvePlanObjects,
} from './compareNearTargetResolvePlan.js';

const PLAN = {
  ok: true,
  candidateCount: 1,
  candidateTerms: ['差一条'],
  plannedCount: 1,
  videosPlanned: 1,
  plans: [
    {
      term: '差一条',
      family: 'attack',
      evidenceNeeded: 1,
      bvids: ['BV1NearAAA1'],
      pages: 3,
      targetExistingTerms: ['差一条'],
    },
  ],
  skipped: [],
  summary: { candidateCount: 1, plannedCount: 1, videosPlanned: 1 },
};

test('compareNearTargetResolvePlanObjects reports matching plans', () => {
  const result = compareNearTargetResolvePlanObjects(PLAN, { ...PLAN, ignored: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, {
    candidateCount: PLAN.candidateCount,
    candidateTerms: PLAN.candidateTerms,
    plannedCount: PLAN.plannedCount,
    videosPlanned: PLAN.videosPlanned,
    plans: PLAN.plans,
    skipped: PLAN.skipped,
    summary: PLAN.summary,
  });
});

test('compareNearTargetResolvePlan compares JS and Python fixture plans', async () => {
  const calls = [];
  const result = await compareNearTargetResolvePlan({
    runJsPlan: async (payload) => {
      calls.push({ js: payload });
      return PLAN;
    },
    runPythonPlan: async (payload) => {
      calls.push({ python: payload });
      return PLAN;
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareNearTargetResolvePlan delegates saved JS plan comparison to Python contract', async () => {
  let compareContext;
  const result = await compareNearTargetResolvePlan({
    runJsPlan: async () => PLAN,
    runPythonPlan: async () => PLAN,
    runCompare: async (context) => {
      compareContext = context;
      return {
        ok: true,
        mismatches: [],
        python: {
          candidateCount: PLAN.candidateCount,
          candidateTerms: PLAN.candidateTerms,
          plannedCount: PLAN.plannedCount,
          videosPlanned: PLAN.videosPlanned,
          plans: PLAN.plans,
          skipped: PLAN.skipped,
          summary: PLAN.summary,
        },
        js: {
          candidateCount: PLAN.candidateCount,
          candidateTerms: PLAN.candidateTerms,
          plannedCount: PLAN.plannedCount,
          videosPlanned: PLAN.videosPlanned,
          plans: PLAN.plans,
          skipped: PLAN.skipped,
          summary: PLAN.summary,
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsPlanPath.endsWith('js-plan.json'), true);
  assert.deepEqual(compareContext.jsPlan, PLAN);
  assert.deepEqual(compareContext.pythonPlan, PLAN);
});
