import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
