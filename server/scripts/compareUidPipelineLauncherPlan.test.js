import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  UID_PIPELINE_LAUNCHER_PLAN_FIXTURES,
  compareUidPipelineLauncherPlan,
  compareUidPipelineLauncherPlanObjects,
} from './compareUidPipelineLauncherPlan.js';

const SUMMARY = {
  workers: [
    { start: 1, end: 20000, progressFile: 'uid-pipeline-1-20000.json' },
    { start: 20001, end: 40000, progressFile: 'uid-pipeline-20001-40000.json' },
    { start: 40001, end: 60000, progressFile: 'uid-pipeline-40001-60000.json' },
    { start: 60001, end: 80000, progressFile: 'uid-pipeline-60001-80000.json' },
    { start: 80001, end: 100000, progressFile: 'uid-pipeline-80001-100000.json' },
  ],
};

test('compareUidPipelineLauncherPlanObjects reports matching launcher state workers', () => {
  const result = compareUidPipelineLauncherPlanObjects(
    { ok: true, startedAt: '', state: { startedAt: '', ...SUMMARY }, ignored: true },
    { ok: true, startedAt: 'dynamic', ...SUMMARY, ignored: false },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidPipelineLauncherPlan compares JS and Python launch plans', async () => {
  const calls = [];
  const result = await compareUidPipelineLauncherPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, state: { startedAt: '', ...SUMMARY } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareUidPipelineLauncherPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(UID_PIPELINE_LAUNCHER_PLAN_FIXTURES), ['default-data-dir', 'custom-data-dir']);

  const dataDirs = [];
  const result = await compareUidPipelineLauncherPlan({
    fixtureNames: Object.keys(UID_PIPELINE_LAUNCHER_PLAN_FIXTURES),
    runJs: async ({ dataDir }) => {
      dataDirs.push(dataDir);
      return { ok: true, ...SUMMARY };
    },
    runPython: async () => ({ ok: true, state: { startedAt: '', ...SUMMARY } }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-data-dir', 'custom-data-dir']);
  assert.equal(dataDirs.length, 2);
  assert.match(dataDirs[0], /server[\\/]data$/);
  assert.equal(dataDirs[1], UID_PIPELINE_LAUNCHER_PLAN_FIXTURES['custom-data-dir'].dataDir);
});

test('launchUidPipeline can delegate dry-run launcher planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-pipeline-launcher-python-plan-'));
  try {
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_pipeline_launcher.py'),
      'print(\'{"ok":true,"fromPythonUidPipelineLauncher":true,"state":{"workers":[{"start":7,"end":9,"progressFile":"uid-pipeline-7-9.json"}]}}\')\n',
      'utf8',
    );

    const result = spawnSync(
      'node',
      [
        resolve('server/scripts/launchUidPipeline.js'),
        '--plan-json',
        '--data-dir',
        join(tempDir, 'server', 'data'),
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          BILIBILI_UID_PIPELINE_LAUNCHER_USE_PYTHON_PLAN: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidPipelineLauncher, true);
    assert.equal(payload.state.workers[0].start, 7);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('launchUidPipeline accepts explicit Python launcher plan flag', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-pipeline-launcher-explicit-python-plan-'));
  try {
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_pipeline_launcher.py'),
      'print(\'{"ok":true,"fromExplicitPythonUidPipelineLauncher":true,"state":{"workers":[{"start":11,"end":12,"progressFile":"uid-pipeline-11-12.json"}]}}\')\n',
      'utf8',
    );

    const result = spawnSync(
      'node',
      [
        resolve('server/scripts/launchUidPipeline.js'),
        '--plan-json',
        '--python-plan',
        '--data-dir',
        join(tempDir, 'server', 'data'),
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromExplicitPythonUidPipelineLauncher, true);
    assert.equal(payload.state.workers[0].start, 11);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
