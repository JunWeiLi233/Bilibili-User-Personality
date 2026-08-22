import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  UID_PIPELINE_WORKER_PLAN_FIXTURES,
  compareUidPipelineWorkerPlan,
  compareUidPipelineWorkerPlanObjects,
} from './compareUidPipelineWorkerPlan.js';

const PLAN = {
  range: { start: 10, end: 12, total: 3 },
  progress: { processed: 2, remaining: 1, completionRatio: 0.6667 },
  limits: {
    videosPerUser: 3,
    commentPagesPerVideo: 2,
    commentTextMinChars: 10,
    commentTextLimit: 8000,
  },
  pacing: {
    delayUidMs: 1500,
    delayRequestMs: 500,
    saveEvery: 20,
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    lockRetryDelayMs: 10000,
    lockMaxRetries: 5,
  },
  blockPolicy: {
    blockedCodes: [-799, -352],
    consecutiveBlockThreshold: 3,
    blockBackoffBaseMs: 30000,
    blockBackoffMaxMultiplier: 10,
  },
  stats: { success: 1, noComments: 0, noVideos: 0, noUser: 1, trainError: 0, blocked: 0, errors: 0 },
  userDb: { users: 2, usersInRange: 1 },
};

test('compareUidPipelineWorkerPlanObjects reports matching worker plans', () => {
  const result = compareUidPipelineWorkerPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidPipelineWorkerPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidPipelineWorkerPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...PLAN };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...PLAN };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareUidPipelineWorkerPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(UID_PIPELINE_WORKER_PLAN_FIXTURES), ['default-range', 'parseint-prefix']);

  const payloads = [];
  const result = await compareUidPipelineWorkerPlan({
    fixtureNames: Object.keys(UID_PIPELINE_WORKER_PLAN_FIXTURES),
    runJs: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, ...PLAN };
    },
    runPython: async () => ({ ok: true, ...PLAN }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-range', 'parseint-prefix']);
  assert.deepEqual(payloads, [
    UID_PIPELINE_WORKER_PLAN_FIXTURES['default-range'],
    UID_PIPELINE_WORKER_PLAN_FIXTURES['parseint-prefix'],
  ]);
});

test('uidPipelineWorker can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-pipeline-worker-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--start=10', '--end=12'],
          progress: { processed: {}, stats: {} },
          database: { users: {} },
        },
        null,
        2,
      ),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_pipeline_plan.py'),
      'print(\'{"ok":true,"fromPythonUidPipelineWorkerPlan":true,"range":{"start":10,"end":12,"total":3},"progress":{"remaining":3}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidPipelineWorker.js'), '--plan-json', `--payload=${payloadPath}`], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_PIPELINE_WORKER_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidPipelineWorkerPlan, true);
    assert.equal(payload.progress.remaining, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uidPipelineWorker accepts explicit python plan flag for dry-run planning', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-pipeline-worker-explicit-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=10', '--end=12'], progress: { processed: {}, stats: {} }, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_pipeline_plan.py'),
      'print(\'{"ok":true,"fromExplicitPythonUidPipelineWorkerPlan":true,"progress":{"remaining":12}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidPipelineWorker.js'), '--plan-json', '--python-plan', `--payload=${payloadPath}`], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromExplicitPythonUidPipelineWorkerPlan, true);
    assert.equal(payload.progress.remaining, 12);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
