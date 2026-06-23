import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  UID_PARALLEL_PLAN_FIXTURES,
  compareUidParallelPlan,
  compareUidParallelPlanObjects,
} from './compareUidParallelPlan.js';

const PLAN = {
  worker: { id: 1, totalWorkers: 3, assigned: 2 },
  assignment: {
    assignedUids: ['102', '105'],
    alreadyProcessed: 1,
    pending: 1,
    trainable: 1,
    skippableNoText: 0,
  },
  training: { multiagent: true, existingTermsOnly: false, commentTextLimit: 5000, saveEvery: 20 },
  pacing: {
    lockRetryDelayMs: 3000,
    lockRetryJitterMs: 2000,
    lockMaxRetries: 15,
    staleLockRemovalAfterAttempt: 8,
  },
  stats: { success: 1, noText: 0, errors: 0 },
  userDb: { users: 2, assignedUsersInDb: 1 },
};

test('compareUidParallelPlanObjects reports matching parallel analyzer plans', () => {
  const result = compareUidParallelPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidParallelPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidParallelPlan({
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

test('compareUidParallelPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(UID_PARALLEL_PLAN_FIXTURES), ['default-worker', 'parseint-prefix']);

  const payloads = [];
  const result = await compareUidParallelPlan({
    fixtureNames: Object.keys(UID_PARALLEL_PLAN_FIXTURES),
    runJs: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, ...PLAN };
    },
    runPython: async () => ({ ok: true, ...PLAN }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-worker', 'parseint-prefix']);
  assert.deepEqual(payloads, [
    UID_PARALLEL_PLAN_FIXTURES['default-worker'],
    UID_PARALLEL_PLAN_FIXTURES['parseint-prefix'],
  ]);
});

test('uidParallelAnalyzer can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-parallel-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--worker=1', '--workers=3'],
          comments: { 101: [{ message: 'a' }], 102: [{ message: 'b' }] },
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
      join(fakeModuleDir, 'uid_parallel_plan.py'),
      'print(\'{"ok":true,"fromPythonUidParallelPlan":true,"worker":{"id":1,"totalWorkers":3,"assigned":1},"assignment":{"pending":1}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidParallelAnalyzer.js'), '--plan-json', `--payload=${payloadPath}`], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_PARALLEL_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidParallelPlan, true);
    assert.equal(payload.assignment.pending, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
