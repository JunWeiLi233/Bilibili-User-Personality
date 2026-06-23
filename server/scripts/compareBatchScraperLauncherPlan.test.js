import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  BATCH_SCRAPER_LAUNCHER_PLAN_FIXTURES,
  compareBatchScraperLauncherPlan,
  compareBatchScraperLauncherPlanObjects,
} from './compareBatchScraperLauncherPlan.js';

const SUMMARY = {
  workers: [
    { start: 1, end: 20000, progressFile: 'batch-uid-progress-1-20000.json' },
    { start: 20001, end: 40000, progressFile: 'batch-uid-progress-20001-40000.json' },
    { start: 40001, end: 60000, progressFile: 'batch-uid-progress-40001-60000.json' },
    { start: 60001, end: 80000, progressFile: 'batch-uid-progress-60001-80000.json' },
    { start: 80001, end: 100000, progressFile: 'batch-uid-progress-80001-100000.json' },
  ],
  summary: {
    workers: 5,
    totalStart: 1,
    totalEnd: 100000,
    totalUids: 100000,
  },
};

test('compareBatchScraperLauncherPlanObjects reports matching launcher summaries', () => {
  const result = compareBatchScraperLauncherPlanObjects({ ok: true, ...SUMMARY, ignored: true }, { ok: true, ...SUMMARY, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareBatchScraperLauncherPlan compares JS and Python launch plans', async () => {
  const calls = [];
  const result = await compareBatchScraperLauncherPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareBatchScraperLauncherPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(BATCH_SCRAPER_LAUNCHER_PLAN_FIXTURES), ['default-data-dir', 'custom-data-dir']);

  const dataDirs = [];
  const result = await compareBatchScraperLauncherPlan({
    fixtureNames: Object.keys(BATCH_SCRAPER_LAUNCHER_PLAN_FIXTURES),
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
  assert.equal(dataDirs[1], BATCH_SCRAPER_LAUNCHER_PLAN_FIXTURES['custom-data-dir'].dataDir);
});

test('launchAllScrapers can delegate dry-run launcher planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-scraper-launcher-python-plan-'));
  try {
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'batch_scraper_launcher.py'),
      'print(\'{"ok":true,"fromPythonBatchScraperLauncher":true,"workers":[],"summary":{"workers":0,"totalStart":0,"totalEnd":0,"totalUids":0}}\')\n',
      'utf8',
    );

    const result = spawnSync(
      'node',
      [
        resolve('server/scripts/launchAllScrapers.js'),
        '--plan-json',
        '--data-dir',
        join(tempDir, 'server', 'data'),
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          BILIBILI_BATCH_SCRAPER_USE_PYTHON_PLAN: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchScraperLauncher, true);
    assert.equal(payload.summary.workers, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
