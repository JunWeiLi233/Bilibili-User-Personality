import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareHarvestPlan, compareHarvestPlanObjects } from './compareHarvestPlan.js';

const PLAN = {
  queries: ['fresh query', 'missed query'],
  plan: [
    { query: 'fresh query', source: 'dictionary', term: 'fresh', family: 'attack' },
    { query: 'missed query', source: 'dictionary', term: 'missed', family: 'attack' },
  ],
};

test('compareHarvestPlanObjects reports matching query-plan summaries', () => {
  const result = compareHarvestPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareHarvestPlan compares JS and Python dry-run query plans', async () => {
  const calls = [];
  const result = await compareHarvestPlan({
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
