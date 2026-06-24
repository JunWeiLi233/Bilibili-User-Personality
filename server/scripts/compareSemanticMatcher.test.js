import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SEMANTIC_MATCHER_FIXTURES,
  compareSemanticMatcher,
  compareSemanticMatcherObjects,
} from './compareSemanticMatcher.js';

const MATCH_SUMMARY = {
  ok: true,
  mode: 'match',
  chunks: ['alpha semantic chunk'],
  cosine: 0.8,
  matches: [{ term: 'alpha', chunk: 'alpha semantic chunk', score: 1 }],
};

test('compareSemanticMatcherObjects reports matching semantic matcher summaries', () => {
  const result = compareSemanticMatcherObjects(
    { ...MATCH_SUMMARY, ignored: true },
    MATCH_SUMMARY,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, MATCH_SUMMARY);
  assert.deepEqual(result.js, MATCH_SUMMARY);
});

test('compareSemanticMatcher compares injected JS and Python semantic contracts', async () => {
  const calls = [];
  const result = await compareSemanticMatcher({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('semantic-matcher.json') });
      return MATCH_SUMMARY;
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('semantic-matcher.json') });
      return MATCH_SUMMARY;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareSemanticMatcher exports deterministic offline fixtures', async () => {
  assert.deepEqual(Object.keys(SEMANTIC_MATCHER_FIXTURES), [
    'match-precomputed-vectors',
    'cache-payload',
    'evidence-weak-terms',
  ]);

  const result = await compareSemanticMatcher({
    fixtureNames: Object.keys(SEMANTIC_MATCHER_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareSemanticMatcher real runners preserve the offline semantic contract', async () => {
  const result = await compareSemanticMatcher({
    fixtureNames: Object.keys(SEMANTIC_MATCHER_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
