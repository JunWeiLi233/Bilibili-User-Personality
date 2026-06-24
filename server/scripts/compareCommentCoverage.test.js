import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMMENT_COVERAGE_FIXTURES,
  compareCommentCoverage,
  compareCommentCoverageObjects,
} from './compareCommentCoverage.js';

const SUMMARY = {
  total: 4,
  covered: 3,
  uncovered: 1,
  coverageRatio: 0.75,
  byMode: { keyword: 1, neutral: 2, uncovered: 1 },
};

test('compareCommentCoverageObjects compares stable coverage summaries', () => {
  const result = compareCommentCoverageObjects(
    { ok: true, summary: SUMMARY, ignored: true },
    { ok: true, summary: SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { summary: SUMMARY });
  assert.deepEqual(result.js, { summary: SUMMARY });
});

test('compareCommentCoverage compares JS and Python payload coverage contracts', async () => {
  const calls = [];
  const result = await compareCommentCoverage({
    runJs: async ({ payload, payloadPath }) => {
      calls.push({ js: payload.comments.length, hasPayloadPath: payloadPath.endsWith('comment-coverage.json') });
      return { ok: true, summary: SUMMARY };
    },
    runPython: async ({ payload, payloadPath }) => {
      calls.push({ python: payload.comments.length, hasPayloadPath: payloadPath.endsWith('comment-coverage.json') });
      return { ok: true, summary: SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 4, hasPayloadPath: true },
    { python: 4, hasPayloadPath: true },
  ]);
});

test('compareCommentCoverage exports named coverage fixtures', async () => {
  assert.deepEqual(Object.keys(COMMENT_COVERAGE_FIXTURES), [
    'keyword-neutral-uncovered',
    'sample-size-limit',
    'scrape-diagnostic-neutral',
  ]);

  const result = await compareCommentCoverage({
    fixtureNames: Object.keys(COMMENT_COVERAGE_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareCommentCoverage real runners preserve the shared payload contract', async () => {
  const result = await compareCommentCoverage({
    fixtureNames: Object.keys(COMMENT_COVERAGE_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
