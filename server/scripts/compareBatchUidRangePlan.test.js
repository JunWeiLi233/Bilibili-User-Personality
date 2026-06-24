import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  BATCH_UID_RANGE_PLAN_FIXTURES,
  compareBatchUidRangePlan,
  compareBatchUidRangePlanObjects,
} from './compareBatchUidRangePlan.js';

const PLAN = {
  input: {
    start: 200000,
    end: 300000,
    pages: 80,
    phase2Only: true,
  },
  phase1: {
    enabled: false,
    scannedBvids: 2,
    maxPages: 80,
    popularPageSize: 20,
    commentPagesPerVideo: 3,
  },
  phase2: {
    targetUids: 2,
    processed: 2,
    remaining: 0,
    userDbUsers: 1,
  },
  stats: {
    videosScanned: 2,
    uidsFound: 4,
    targetUidsFound: 2,
    commentsCollected: 4,
    analyzed: 1,
    skipped: 1,
    errors: 0,
  },
  pacing: {
    delayBetweenVideosMs: 2000,
    delayBetweenUidsMs: 1500,
    lockRetryDelayMs: 3000,
    lockMaxRetries: 10,
    saveInterval: 5,
  },
};

test('compareBatchUidRangePlanObjects reports matching batch UID range summaries', () => {
  const result = compareBatchUidRangePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchUidRangePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchUidRangePlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...PLAN };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...PLAN };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareBatchUidRangePlan delegates saved JS report comparison to Python contract', async () => {
  let compareContext;
  const jsReport = { ok: true, ...PLAN };
  const pythonReport = { ok: true, ...PLAN };
  const result = await compareBatchUidRangePlan({
    runJs: async () => jsReport,
    runPython: async () => pythonReport,
    runCompare: async (context) => {
      compareContext = context;
      return { ok: true, mismatches: [], python: PLAN, js: PLAN };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsReportPath.endsWith('js-report.json'), true);
  assert.deepEqual(compareContext.jsReport, jsReport);
  assert.deepEqual(compareContext.pythonReport, pythonReport);
});

test('compareBatchUidRangePlan exports named compatibility fixtures', async () => {
  assert.deepEqual(Object.keys(BATCH_UID_RANGE_PLAN_FIXTURES), ['phase2-progress', 'default-range', 'decimal-args-malformed-stats']);

  const payloads = [];
  const result = await compareBatchUidRangePlan({
    fixtureNames: Object.keys(BATCH_UID_RANGE_PLAN_FIXTURES),
    runJs: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, ...PLAN };
    },
    runPython: async () => ({ ok: true, ...PLAN }),
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['phase2-progress', 'default-range', 'decimal-args-malformed-stats']);
  assert.deepEqual(payloads, Object.values(BATCH_UID_RANGE_PLAN_FIXTURES));
});

test('batchUidRange can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-uid-range-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--start=10', '--end=20', '--phase2-only'],
          progress: { scannedBvids: [], _uidComments: {}, processedUids: {}, stats: {} },
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
      join(fakeModuleDir, 'batch_uid_range_plan.py'),
      'print(\'{"ok":true,"fromPythonBatchUidRangePlan":true,"input":{"start":10,"end":20,"phase2Only":true},"phase2":{"remaining":7}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/batchUidRange.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_BATCH_UID_RANGE_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchUidRangePlan, true);
    assert.equal(payload.phase2.remaining, 7);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batchUidRange accepts explicit python plan flag for dry-run planning', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-uid-range-python-plan-flag-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=30', '--end=40', '--phase2-only'], progress: {}, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'batch_uid_range_plan.py'),
      'print(\'{"ok":true,"fromExplicitPythonBatchUidRangePlan":true,"input":{"start":30,"end":40,"phase2Only":true},"phase2":{"remaining":11}}\')\n',
      'utf8',
    );

    const result = spawnSync(
      'node',
      [resolve('server/scripts/batchUidRange.js'), '--plan-json', '--python-plan', '--payload', payloadPath],
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
    assert.equal(payload.fromExplicitPythonBatchUidRangePlan, true);
    assert.equal(payload.phase2.remaining, 11);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
