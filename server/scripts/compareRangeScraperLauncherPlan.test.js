import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RANGE_SCRAPER_LAUNCHER_PLAN_FIXTURES,
  compareRangeScraperLauncherPlan,
  compareRangeScraperLauncherPlanObjects,
} from './compareRangeScraperLauncherPlan.js';

const SUMMARY = {
  workers: [
    { start: 1, end: 20000, progressFile: 'uid-range-progress-1-20000.json' },
    { start: 20001, end: 40000, progressFile: 'uid-range-progress-20001-40000.json' },
    { start: 40001, end: 60000, progressFile: 'uid-range-progress-40001-60000.json' },
    { start: 60001, end: 80000, progressFile: 'uid-range-progress-60001-80000.json' },
    { start: 80001, end: 100000, progressFile: 'uid-range-progress-80001-100000.json' },
  ],
  summary: {
    workers: 5,
    totalStart: 1,
    totalEnd: 100000,
    totalUids: 100000,
    launchDelaySeconds: 3,
  },
};

test('compareRangeScraperLauncherPlanObjects reports matching launcher summaries', () => {
  const result = compareRangeScraperLauncherPlanObjects({ ok: true, ...SUMMARY, ignored: true }, { ok: true, ...SUMMARY, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareRangeScraperLauncherPlan compares JS-compatible and Python launch plans', async () => {
  const calls = [];
  const result = await compareRangeScraperLauncherPlan({
    runJs: async (context) => {
      calls.push({ js: context.dataDir });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.dataDir });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].js, calls[1].python);
});

test('compareRangeScraperLauncherPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(RANGE_SCRAPER_LAUNCHER_PLAN_FIXTURES), ['default-data-dir', 'custom-data-dir']);

  const dataDirs = [];
  const result = await compareRangeScraperLauncherPlan({
    fixtureNames: Object.keys(RANGE_SCRAPER_LAUNCHER_PLAN_FIXTURES),
    runJs: async ({ dataDir }) => {
      dataDirs.push(dataDir);
      return { ok: true, ...SUMMARY };
    },
    runPython: async () => ({ ok: true, ...SUMMARY }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-data-dir', 'custom-data-dir']);
  assert.equal(dataDirs.length, 2);
  assert.match(dataDirs[0], /server[\\/]data$/);
  assert.equal(dataDirs[1], RANGE_SCRAPER_LAUNCHER_PLAN_FIXTURES['custom-data-dir'].dataDir);
});
