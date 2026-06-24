import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RANDOM_VERIFICATION_FIXTURES,
  compareRandomVerification,
  compareRandomVerificationObjects,
} from './compareRandomVerification.js';

test('compareRandomVerificationObjects reports metric drift', () => {
  const result = compareRandomVerificationObjects(
    { sampleSize: 2, seed: 1, sampled: 2, keywordHits: 2, neutral: 0, uncovered: 0 },
    { sampleSize: 2, seed: 1, sampled: 2, keywordHits: 1, neutral: 1, uncovered: 0 },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'keywordHits', python: 2, js: 1 },
    { key: 'neutral', python: 0, js: 1 },
  ]);
});

test('compareRandomVerification compares injected JS and Python runners', async () => {
  const result = await compareRandomVerification({
    payload: {
      sampleSize: 1,
      seed: 1,
      corpus: { comments: [{ message: 'doge' }] },
      dictionary: { entries: [{ term: 'doge' }] },
    },
    runJs: async () => ({ sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 }),
    runPython: async () => ({ sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
  assert.equal(result.fixture.jsReportPath.endsWith('js-report.json'), true);
});

test('compareRandomVerification delegates persisted report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareRandomVerification({
    payload: {
      sampleSize: 1,
      seed: 1,
      corpus: { comments: [{ message: 'doge' }] },
      dictionary: { entries: [{ term: 'doge' }] },
    },
    runJs: async () => ({ sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 }),
    runPython: async () => ({ sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 }),
    runCompare: async (context) => {
      calls.push({
        pythonReport: context.pythonReport.keywordHits,
        jsReport: context.jsReport.keywordHits,
        hasPythonReportPath: context.pythonReportPath.endsWith('python-report.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
        hasCompareJsReportPath: context.compareJsReportPath.endsWith('js-report.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }]);
  assert.deepEqual(calls, [
    { pythonReport: 1, jsReport: 1, hasPythonReportPath: true, hasJsReportPath: true, hasCompareJsReportPath: true },
  ]);
});

test('compareRandomVerification exports named payload fixtures', async () => {
  assert.deepEqual(Object.keys(RANDOM_VERIFICATION_FIXTURES), [
    'emoji-keyword-hit',
    'emoji-alias-hit',
    'ascii-boundary-neutral',
  ]);

  const calls = [];
  const result = await compareRandomVerification({
    fixtureNames: Object.keys(RANDOM_VERIFICATION_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasJsReportPath: context.jsReportPath.endsWith('js-report.json') });
      return { sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'emoji-keyword-hit', hasPayloadPath: true },
    { python: 'emoji-keyword-hit', hasJsReportPath: true },
    { js: 'emoji-alias-hit', hasPayloadPath: true },
    { python: 'emoji-alias-hit', hasJsReportPath: true },
    { js: 'ascii-boundary-neutral', hasPayloadPath: true },
    { python: 'ascii-boundary-neutral', hasJsReportPath: true },
  ]);
});
