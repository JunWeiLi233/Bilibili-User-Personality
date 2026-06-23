import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  BATCH_BILIBILI_PLAN_FIXTURES,
  compareBatchBilibiliPlan,
  compareBatchBilibiliPlanObjects,
} from './compareBatchBilibiliPlan.js';

const PLAN = {
  input: {
    startUid: 100000,
    endUid: 100005,
  },
  range: {
    startUid: 100003,
    endUid: 100005,
    total: 3,
  },
  resume: {
    lastUid: 100002,
    resumed: true,
  },
  database: {
    users: 3,
  },
  limits: {
    maxVideos: 3,
    maxComments: 50,
    replyPages: 1,
  },
  pacing: {
    delayBetweenRequestsMs: 3000,
    delayBetweenUidsMs: 15000,
    delayAfterRateLimitMs: 60000,
  },
  retry: {
    maxRetries: 3,
    rateLimitCodes: [-799, -412],
    htmlWafDetection: true,
    hasUserAgent: true,
    referer: 'https://www.bilibili.com/',
  },
  browser: {
    command: 'browser-harness',
    script: 'server/scripts/browserGetVideos.py',
    wrapper: 'server/data/_browser_tmp.py',
    timeoutMs: 45000,
    maxVideos: 3,
  },
  sampleRequests: {
    uid: '100003',
    cardUrl: 'https://api.bilibili.com/x/web-interface/card?mid=100003',
    replyUrl: 'https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1',
    wrapperArgv: ['browserGetVideos.py', '100003', '3'],
  },
  progress: {
    completed: 2,
    errors: 1,
  },
};

test('compareBatchBilibiliPlanObjects reports matching batch Bilibili summaries', () => {
  const result = compareBatchBilibiliPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchBilibiliPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchBilibiliPlan({
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

test('compareBatchBilibiliPlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(BATCH_BILIBILI_PLAN_FIXTURES), ['resume-progress', 'empty-progress', 'parseint-prefix-progress']);

  const payloads = [];
  const result = await compareBatchBilibiliPlan({
    fixtureNames: Object.keys(BATCH_BILIBILI_PLAN_FIXTURES),
    runJs: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, ...PLAN };
    },
    runPython: async () => ({ ok: true, ...PLAN }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['resume-progress', 'empty-progress', 'parseint-prefix-progress']);
  assert.deepEqual(payloads, Object.values(BATCH_BILIBILI_PLAN_FIXTURES));
});

test('batchScrapeBilibili can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-bilibili-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--start=100000', '--end=100002'],
          progress: { lastUid: 0, completed: 0, errors: [] },
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
    writeFileSync(join(fakeModuleDir, 'batch_bilibili_plan.py'), 'print(\'{"ok":true,"fromPythonBatchBilibiliPlan":true,"range":{"startUid":42,"endUid":42,"total":1}}\')\n', 'utf8');

    const result = spawnSync('node', [resolve('server/scripts/batchScrapeBilibili.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_BATCH_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchBilibiliPlan, true);
    assert.equal(payload.range.startUid, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
