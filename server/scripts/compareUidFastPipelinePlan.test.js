import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareUidFastPipelinePlan, compareUidFastPipelinePlanObjects } from './compareUidFastPipelinePlan.js';

const PLAN = {
  range: { start: 2, end: 4, total: 3 },
  progress: { processed: 2, remaining: 1, completionRatio: 0.6667 },
  limits: {
    videosPerUser: 3,
    commentPagesPerVideo: 2,
    replyPageSize: 20,
    commentTextMinChars: 10,
    commentTextLimit: 8000,
  },
  network: { mode: 'directFetchJson', usesCrawlerRateLimiter: false, hasUserAgent: true },
  pacing: {
    delayUidMs: 3500,
    delayFastFailUidMs: 1800,
    delayRequestMs: 1800,
    cursorDelayMs: 200,
    saveEvery: 20,
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    lockRetryDelayMs: 5000,
    lockRetryJitterMs: 2000,
    lockMaxRetries: 15,
    forceCleanLockAfterAttempt: 10,
  },
  blockPolicy: {
    blockedCodes: [-799, -352],
    consecutiveBlockThreshold: 3,
    blockBackoffBaseMs: 15000,
    blockBackoffMaxMultiplier: 10,
  },
  stats: { success: 1, noComments: 0, noVideos: 0, noUser: 1, trainError: 0, blocked: 0, errors: 0 },
  userDb: { users: 2, usersInRange: 1 },
};

test('compareUidFastPipelinePlanObjects reports matching worker plans', () => {
  const result = compareUidFastPipelinePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidFastPipelinePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidFastPipelinePlan({
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

test('uidPipelineFast can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-fast-pipeline-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--start=2', '--end=4'],
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
      join(fakeModuleDir, 'uid_fast_pipeline_plan.py'),
      'print(\'{"ok":true,"fromPythonUidFastPipelinePlan":true,"range":{"start":2,"end":4,"total":3},"network":{"mode":"python-fast-plan"}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidPipelineFast.js'), '--plan-json', `--payload=${payloadPath}`], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_FAST_PIPELINE_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidFastPipelinePlan, true);
    assert.equal(payload.network.mode, 'python-fast-plan');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
