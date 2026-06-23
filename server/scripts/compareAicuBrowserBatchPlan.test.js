import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  AICU_BROWSER_BATCH_PLAN_FIXTURES,
  compareAicuBrowserBatchPlan,
  compareAicuBrowserBatchPlanObjects,
} from './compareAicuBrowserBatchPlan.js';

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
  browser: {
    command: 'browser-harness',
    script: 'server/scripts/browserScrapeAicu.py',
    wrapper: 'server/data/_browser_aicu_tmp.py',
    timeoutMs: 120000,
    maxPages: 3,
  },
  pacing: {
    delayBetweenUidsMs: 5000,
    saveEveryAttempts: 10,
  },
  sampleInvocation: {
    uid: '100003',
    wrapperArgv: ['browserScrapeAicu.py', '100003', '3'],
    exec: 'browser-harness -c "exec(open(\'server/data/_browser_aicu_tmp.py\').read())"',
  },
};

test('compareAicuBrowserBatchPlanObjects reports matching browser batch plan summaries', () => {
  const result = compareAicuBrowserBatchPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuBrowserBatchPlan compares JS and Python dry-run browser batch plans', async () => {
  const calls = [];
  const result = await compareAicuBrowserBatchPlan({
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

test('compareAicuBrowserBatchPlan exports named payload fixtures', async () => {
  assert.deepEqual(Object.keys(AICU_BROWSER_BATCH_PLAN_FIXTURES), [
    'default-range',
    'fresh-range',
    'completed-range',
  ]);

  const calls = [];
  const result = await compareAicuBrowserBatchPlan({
    fixtureNames: Object.keys(AICU_BROWSER_BATCH_PLAN_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { ok: true, ...PLAN };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { ok: true, ...PLAN };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-range', hasPayloadPath: true },
    { python: 'default-range', hasPayloadPath: true },
    { js: 'fresh-range', hasPayloadPath: true },
    { python: 'fresh-range', hasPayloadPath: true },
    { js: 'completed-range', hasPayloadPath: true },
    { python: 'completed-range', hasPayloadPath: true },
  ]);
});

test('batchScrapeAicuBrowser can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aicu-browser-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=100000', '--end=100005'], progress: {}, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'aicu_browser_batch_plan.py'),
      'print(\'{"ok":true,"fromPythonAicuBrowserPlan":true,"range":{"effectiveStart":100000},"browser":{"command":"python-browser-plan"}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/batchScrapeAicuBrowser.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_AICU_BROWSER_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonAicuBrowserPlan, true);
    assert.equal(payload.browser.command, 'python-browser-plan');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
