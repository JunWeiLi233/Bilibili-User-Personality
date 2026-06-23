import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareExhaustedTermsPrunePlan,
  compareExhaustedTermsPrunePlanObjects,
} from './compareExhaustedTermsPrunePlan.js';

const PLAN = {
  ok: true,
  count: 1,
  candidates: [{ term: '零证据', family: 'attack', attempts: 12, evidence: 0 }],
  summary: { attemptThreshold: 10, requireZeroEvidence: true, candidates: 1 },
};

test('compareExhaustedTermsPrunePlanObjects reports matching plans', () => {
  const result = compareExhaustedTermsPrunePlanObjects(PLAN, { ...PLAN, ignored: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, {
    count: PLAN.count,
    candidates: PLAN.candidates,
    summary: PLAN.summary,
  });
});

test('compareExhaustedTermsPrunePlan compares JS and Python fixture plans', async () => {
  const calls = [];
  const result = await compareExhaustedTermsPrunePlan({
    runJsPlan: async (payload) => {
      calls.push({ js: payload });
      return PLAN;
    },
    runPythonPlan: async (payload) => {
      calls.push({ python: payload });
      return PLAN;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});
