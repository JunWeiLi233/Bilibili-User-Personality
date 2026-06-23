import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  UID_FAST_WORKER_PLAN_FIXTURES,
  compareUidFastPipelineWorkerPlan,
  compareUidFastPipelineWorkerPlanObjects,
} from './compareUidFastPipelineWorkerPlan.js';

const PLAN = {
  range: { start: 2, end: 4, total: 3, concurrency: 7 },
  progress: { processed: 2, remaining: 1, completionRatio: 0.6667 },
  limits: { videosPerUser: 3, commentPagesPerVideo: 2, commentTextMinChars: 10, commentTextLimit: 8000 },
  network: { mode: 'crawlerFetchJson', usesCrawlerRateLimiter: true, usesWorkerLock: true },
  pacing: { delayUidMs: 1200, delayRequestMs: 400, saveEvery: 20 },
  training: { multiagent: true, existingTermsOnly: false, lockRetryDelayMs: 8000, lockMaxRetries: 3 },
  blockPolicy: { blockedCodes: [-799, -352], consecutiveBlockThreshold: 3, blockBackoffBaseMs: 20000 },
  stats: { success: 1, noComments: 0, noVideos: 0, noUser: 1, trainError: 0, blocked: 0, errors: 0 },
  userDb: { users: 2, usersInRange: 1 },
};

test('compareUidFastPipelineWorkerPlanObjects reports matching worker plans', () => {
  const result = compareUidFastPipelineWorkerPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidFastPipelineWorkerPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidFastPipelineWorkerPlan({
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

test('compareUidFastPipelineWorkerPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(UID_FAST_WORKER_PLAN_FIXTURES), ['default-worker', 'number-fallback-and-parseint-uids']);

  const payloads = [];
  const result = await compareUidFastPipelineWorkerPlan({
    fixtureNames: Object.keys(UID_FAST_WORKER_PLAN_FIXTURES),
    runJs: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, ...PLAN };
    },
    runPython: async () => ({ ok: true, ...PLAN }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-worker', 'number-fallback-and-parseint-uids']);
  assert.deepEqual(payloads, [
    UID_FAST_WORKER_PLAN_FIXTURES['default-worker'],
    UID_FAST_WORKER_PLAN_FIXTURES['number-fallback-and-parseint-uids'],
  ]);
});

test('uidPipelineFastWorker can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-fast-worker-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=2', '--end=4', '--concurrency=7'], progress: { processed: {}, stats: {} }, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_fast_pipeline_worker_plan.py'),
      'print(\'{"ok":true,"fromPythonUidFastWorkerPlan":true,"range":{"start":2,"end":4,"concurrency":7},"network":{"mode":"python-worker-plan"}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidPipelineFastWorker.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_FAST_WORKER_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidFastWorkerPlan, true);
    assert.equal(payload.network.mode, 'python-worker-plan');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
