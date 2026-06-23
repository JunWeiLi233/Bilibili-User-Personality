import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareScraperMonitor, compareScraperMonitorObjects } from './compareScraperMonitor.js';

const SUMMARY = {
  discovery: { analyzed: 4, found: 10, remaining: 6, errors: 2 },
  pipeline: {
    processed: 3,
    success: 1,
    noComments: 1,
    noVideos: 1,
    noUser: 0,
    errors: 1,
    remaining: 1,
    etaMinutes: 1,
    etaHours: 0,
  },
  combined: { uidsAnalyzed: 5 },
};

test('compareScraperMonitorObjects reports matching monitor summaries', () => {
  const result = compareScraperMonitorObjects({ ok: true, ...SUMMARY, extra: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareScraperMonitor compares JS-compatible and Python monitor reports', async () => {
  const calls = [];
  const result = await compareScraperMonitor({
    payload: { totalStart: 1, totalEnd: 4, workers: 2, pipelineRatePerMinute: 2 },
    runJs: async (context) => {
      calls.push({ js: context.totalStart, end: context.totalEnd, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.totalStart, end: context.totalEnd, workers: context.workers });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 1, end: 4, workers: 2 },
    { python: 1, end: 4, workers: 2 },
  ]);
});
