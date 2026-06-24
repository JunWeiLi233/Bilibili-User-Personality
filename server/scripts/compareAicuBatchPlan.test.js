import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareAicuBatchPlan, compareAicuBatchPlanObjects, compareAicuBatchPlanSuite } from './compareAicuBatchPlan.js';

const PLAN = {
  range: {
    requestedStart: 100000,
    effectiveStart: 100003,
    end: 100005,
    total: 3,
  },
  progress: {
    lastUid: 100002,
    completed: 2,
    errors: 1,
  },
  database: {
    users: 3,
    existingInEffectiveRange: 1,
  },
  limits: {
    maxPages: 3,
    pageSize: 20,
    saveEveryAttempts: 5,
  },
  pacing: {
    delayBetweenPagesMs: 10000,
    delayBetweenUidsMs: 20000,
    delayAfterWafMs: 120000,
  },
  retry: {
    maxRetries: 3,
    wafStatuses: [429, 468, 1015],
    headers: {
      accept: 'application/json',
      referer: 'https://www.aicu.cc/',
      hasUserAgent: true,
    },
  },
  sampleRequests: {
    uid: '100003',
    commentsUrl: 'https://api.aicu.cc/api/v3/search/getreply?uid=100003&pn=1&ps=20&mode=0&keyword=',
    danmakuUrl: 'https://api.aicu.cc/api/v3/search/getvideodm?uid=100003&pn=1&ps=20&keyword=',
  },
};

test('compareAicuBatchPlanObjects reports matching batch plan summaries', () => {
  const result = compareAicuBatchPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuBatchPlan compares JS and Python dry-run batch plans', async () => {
  const calls = [];
  const result = await compareAicuBatchPlan({
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

test('compareAicuBatchPlanSuite covers resume, empty range, and malformed payload fixtures', async () => {
  const result = await compareAicuBatchPlanSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['resume-with-existing-users', 'empty-effective-range', 'malformed-payload']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'empty-effective-range').python.range.total, 0);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'empty-effective-range').python.sampleRequests.uid, '');
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'malformed-payload').python.range.requestedStart, 100000);
});

test('batchScrapeAicu can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aicu-batch-python-plan-'));
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
    writeFileSync(join(fakeModuleDir, 'aicu_batch_plan.py'), 'print(\'{"ok":true,"fromPythonBatchPlan":true,"range":{"requestedStart":42,"effectiveStart":42,"end":42,"total":1}}\')\n', 'utf8');

    const result = spawnSync('node', [resolve('server/scripts/batchScrapeAicu.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        AICU_BATCH_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchPlan, true);
    assert.equal(payload.range.requestedStart, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batchScrapeAicu accepts explicit python plan flag for dry-run planning', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aicu-batch-python-plan-flag-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=100010', '--end=100011'], progress: {}, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'aicu_batch_plan.py'),
      'print(\'{"ok":true,"fromExplicitPythonBatchPlan":true,"range":{"requestedStart":77,"effectiveStart":77,"end":77,"total":1}}\')\n',
      'utf8',
    );

    const result = spawnSync(
      'node',
      [resolve('server/scripts/batchScrapeAicu.js'), '--plan-json', '--python-plan', '--payload', payloadPath],
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
    assert.equal(payload.fromExplicitPythonBatchPlan, true);
    assert.equal(payload.range.requestedStart, 77);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
