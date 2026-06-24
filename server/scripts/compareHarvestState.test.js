import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HARVEST_STATE_FIXTURES, compareHarvestState, compareHarvestStateObjects } from './compareHarvestState.js';

const TERM_ATTEMPTS = {
  'dGVzdC10ZXJt': {
    key: 'dGVzdC10ZXJt',
    term: 'test-term',
    family: 'attack',
    attempts: 1,
    successfulAttempts: 1,
    lastQuery: 'test-term comments',
  },
};

test('compareHarvestStateObjects reports matching state summaries', () => {
  const result = compareHarvestStateObjects(
    { ok: true, termAttempts: TERM_ATTEMPTS, ignored: true },
    { ok: true, termAttempts: TERM_ATTEMPTS },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { termAttempts: TERM_ATTEMPTS });
  assert.deepEqual(result.js, { termAttempts: TERM_ATTEMPTS });
});

test('compareHarvestState compares JS-compatible and Python harvest state results', async () => {
  const calls = [];
  const result = await compareHarvestState({
    payload: { mode: 'default', planItem: { term: 'test-term', query: 'test-term comments' }, result: { ok: true } },
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareHarvestState delegates saved JS state comparison to Python contract', async () => {
  let compareContext;
  const result = await compareHarvestState({
    payload: { mode: 'default', planItem: { term: 'test-term', query: 'test-term comments' }, result: { ok: true } },
    runJs: async () => ({ ok: true, termAttempts: TERM_ATTEMPTS }),
    runPython: async () => ({ ok: true, termAttempts: TERM_ATTEMPTS }),
    runCompare: async (context) => {
      compareContext = context;
      return {
        ok: true,
        mismatches: [],
        python: { termAttempts: TERM_ATTEMPTS },
        js: { termAttempts: TERM_ATTEMPTS },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsStatePath.endsWith('js-state.json'), true);
  assert.deepEqual(compareContext.jsState, { ok: true, termAttempts: TERM_ATTEMPTS });
  assert.deepEqual(compareContext.pythonState, { ok: true, termAttempts: TERM_ATTEMPTS });
});

test('compareHarvestState exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(HARVEST_STATE_FIXTURES), ['default-miss', 'successful-hit', 'corrupt-payload']);

  const calls = [];
  const result = await compareHarvestState({
    fixtureNames: Object.keys(HARVEST_STATE_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('harvest-state.json') });
      return { ok: true, termAttempts: TERM_ATTEMPTS };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-miss', hasPayloadPath: true },
    { python: 'default-miss', hasPayloadPath: true },
    { js: 'successful-hit', hasPayloadPath: true },
    { python: 'successful-hit', hasPayloadPath: true },
    { js: 'corrupt-payload', hasPayloadPath: true },
    { python: 'corrupt-payload', hasPayloadPath: true },
  ]);
});
