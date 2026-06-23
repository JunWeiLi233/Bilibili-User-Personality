import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BATCH_SCRAPE_PROGRESS_FIXTURES, compareBatchScrapeProgress, compareBatchScrapeProgressObjects } from './compareBatchScrapeProgress.js';

const SUMMARY = {
  mode: 'uid-range',
  progress: { lastUid: 105, completed: 3, errors: 2, remaining: 5, rangeTotal: 11 },
  database: { users: 2, withComments: 2, comments: 4, danmaku: 2 },
  timestamps: {
    startTime: '2026-06-19T00:00:00.000Z',
    endTime: '2026-06-19T00:10:00.000Z',
    lastUpdated: '2026-06-19T00:11:00.000Z',
  },
};

test('compareBatchScrapeProgressObjects reports matching progress summaries', () => {
  const result = compareBatchScrapeProgressObjects({ ok: true, ...SUMMARY, progressFile: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareBatchScrapeProgress compares JS-compatible and Python progress reports', async () => {
  const calls = [];
  const result = await compareBatchScrapeProgress({
    payload: { startUid: 100, endUid: 110 },
    runJs: async (context) => {
      calls.push({ js: context.startUid, end: context.endUid, mode: context.mode });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.startUid, end: context.endUid, mode: context.mode });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 100, end: 110, mode: 'uid-range' },
    { python: 100, end: 110, mode: 'uid-range' },
  ]);
});

test('compareBatchScrapeProgress exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(BATCH_SCRAPE_PROGRESS_FIXTURES), ['uid-range-default', 'popular-progress', 'corrupt-inputs']);

  const calls = [];
  const result = await compareBatchScrapeProgress({
    fixtureNames: Object.keys(BATCH_SCRAPE_PROGRESS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, mode: context.mode, progressFile: context.progressFile });
      return { ok: true, ...SUMMARY, mode: context.mode };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, mode: context.mode, progressFile: context.progressFile });
      return { ok: true, ...SUMMARY, mode: context.mode };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'uid-range-default', mode: 'uid-range', progressFile: 'batch-scrape-progress.json' },
    { python: 'uid-range-default', mode: 'uid-range', progressFile: 'batch-scrape-progress.json' },
    { js: 'popular-progress', mode: 'popular', progressFile: 'batch-scrape-popular-progress.json' },
    { python: 'popular-progress', mode: 'popular', progressFile: 'batch-scrape-popular-progress.json' },
    { js: 'corrupt-inputs', mode: 'uid-range', progressFile: 'batch-scrape-progress.json' },
    { python: 'corrupt-inputs', mode: 'uid-range', progressFile: 'batch-scrape-progress.json' },
  ]);
});
