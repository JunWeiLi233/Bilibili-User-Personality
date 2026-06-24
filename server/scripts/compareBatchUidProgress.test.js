import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BATCH_UID_PROGRESS_FIXTURES, compareBatchUidProgress, compareBatchUidProgressObjects } from './compareBatchUidProgress.js';

const SUMMARY = {
  discovery: { videosScanned: 3, uidsDiscovered: 3, commentsCollected: 4 },
  phase2: { processed: 3, success: 1, errors: 1, skipped: 1, remaining: 0 },
  comments: { total: 3, averagePerUid: 1, uidsWithComments: 2 },
  stats: { videosScanned: 3, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 2 },
};

test('compareBatchUidProgressObjects reports matching progress summaries', () => {
  const result = compareBatchUidProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareBatchUidProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareBatchUidProgress({
    runJs: async (context) => {
      calls.push({ js: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareBatchUidProgress delegates saved JS report comparison to Python contract', async () => {
  let compareContext;
  const jsReport = { ok: true, ...SUMMARY };
  const pythonReport = { ok: true, ...SUMMARY };
  const result = await compareBatchUidProgress({
    runJs: async () => jsReport,
    runPython: async () => pythonReport,
    runCompare: async (context) => {
      compareContext = context;
      return { ok: true, mismatches: [], python: SUMMARY, js: SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsReportPath.endsWith('js-report.json'), true);
  assert.deepEqual(compareContext.jsReport, jsReport);
  assert.deepEqual(compareContext.pythonReport, pythonReport);
});

test('compareBatchUidProgress exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(BATCH_UID_PROGRESS_FIXTURES), ['default-state', 'parseint-stats-prefix', 'corrupt-input']);

  const calls = [];
  const result = await compareBatchUidProgress({
    fixtureNames: Object.keys(BATCH_UID_PROGRESS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasProgressPath: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasProgressPath: context.progressPath.endsWith('batch-uid-progress.json') });
      return { ok: true, ...SUMMARY };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-state', hasProgressPath: true },
    { python: 'default-state', hasProgressPath: true },
    { js: 'parseint-stats-prefix', hasProgressPath: true },
    { python: 'parseint-stats-prefix', hasProgressPath: true },
    { js: 'corrupt-input', hasProgressPath: true },
    { python: 'corrupt-input', hasProgressPath: true },
  ]);
});
