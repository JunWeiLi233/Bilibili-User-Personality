import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UID_RANGE_PROGRESS_FIXTURES, compareUidRangeProgress, compareUidRangeProgressObjects } from './compareUidRangeProgress.js';

const SUMMARY = {
  range: { start: 200000, end: 300000 },
  discovery: { videosScanned: 2, uidsDiscovered: 4, targetUidsDiscovered: 2, commentsCollected: 5 },
  phase2: { processed: 2, success: 1, errors: 1, skipped: 1, remaining: 0 },
  comments: { totalForTargetUids: 3, averagePerTargetUid: 1.5 },
};

test('compareUidRangeProgressObjects reports matching progress summaries', () => {
  const result = compareUidRangeProgressObjects({ ok: true, ...SUMMARY, lastUpdated: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidRangeProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareUidRangeProgress({
    payload: { start: 200000, end: 300000 },
    runJs: async (context) => {
      calls.push({ js: context.start, end: context.end });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.start, end: context.end });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: 200000, end: 300000 }, { python: 200000, end: 300000 }]);
});

test('compareUidRangeProgress exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(UID_RANGE_PROGRESS_FIXTURES), ['default-range', 'parseint-stats-prefix', 'corrupt-input']);

  const calls = [];
  const result = await compareUidRangeProgress({
    fixtureNames: Object.keys(UID_RANGE_PROGRESS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, start: context.start, end: context.end });
      return { ok: true, ...SUMMARY, range: { start: context.start, end: context.end } };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, start: context.start, end: context.end });
      return { ok: true, ...SUMMARY, range: { start: context.start, end: context.end } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-range', start: 200000, end: 300000 },
    { python: 'default-range', start: 200000, end: 300000 },
    { js: 'parseint-stats-prefix', start: 200000, end: 300000 },
    { python: 'parseint-stats-prefix', start: 200000, end: 300000 },
    { js: 'corrupt-input', start: 200000, end: 300000 },
    { python: 'corrupt-input', start: 200000, end: 300000 },
  ]);
});
