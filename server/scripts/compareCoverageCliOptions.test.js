import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COVERAGE_CLI_OPTIONS_FIXTURES,
  compareCoverageCliOptions,
  compareCoverageCliOptionsObjects,
} from './compareCoverageCliOptions.js';

test('compareCoverageCliOptionsObjects reports coverage runtime option drift', () => {
  const result = compareCoverageCliOptionsObjects(
    {
      mode: 'coverage-runtime',
      options: { targetEvidence: 2 },
      priorityQueries: ['ignored'],
    },
    {
      mode: 'coverage-runtime',
      options: { targetEvidence: 3 },
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'options',
      python: { targetEvidence: 2 },
      js: { targetEvidence: 3 },
    },
  ]);
  assert.deepEqual(result.python, {
    mode: 'coverage-runtime',
    options: { targetEvidence: 2 },
  });
});

test('compareCoverageCliOptions compares injected JS and Python option runners', async () => {
  const result = await compareCoverageCliOptions({
    payload: {
      argv: ['--strict-comment-backed', '--target-evidence', '2'],
      env: {},
    },
    runJs: async () => ({
      mode: 'coverage-runtime',
      options: { targetEvidence: 2, requireCommentBackedEvidence: true },
    }),
    runPython: async () => ({
      mode: 'coverage-runtime',
      options: { targetEvidence: 2, requireCommentBackedEvidence: true },
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});

test('compareCoverageCliOptions exports named option fixtures', async () => {
  assert.deepEqual(Object.keys(COVERAGE_CLI_OPTIONS_FIXTURES), [
    'default-runtime-options',
    'env-fallbacks',
    'strict-source-backed',
  ]);

  const calls = [];
  const result = await compareCoverageCliOptions({
    fixtureNames: Object.keys(COVERAGE_CLI_OPTIONS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'coverage-runtime', options: { targetEvidence: 3 } };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'coverage-runtime', options: { targetEvidence: 3 } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-runtime-options', hasPayloadPath: true },
    { python: 'default-runtime-options', hasPayloadPath: true },
    { js: 'env-fallbacks', hasPayloadPath: true },
    { python: 'env-fallbacks', hasPayloadPath: true },
    { js: 'strict-source-backed', hasPayloadPath: true },
    { python: 'strict-source-backed', hasPayloadPath: true },
  ]);
});
