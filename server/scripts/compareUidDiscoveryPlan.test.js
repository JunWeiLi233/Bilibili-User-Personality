import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareUidDiscoveryPlan, compareUidDiscoveryPlanObjects, compareUidDiscoveryPlanSuite } from './compareUidDiscoveryPlan.js';

const PLAN = {
  resume: {
    phase: 'analysis',
    skipDiscovery: true,
    scannedBvids: 2,
    savedUidComments: 3,
  },
  sources: {
    popularPages: 30,
    popularPageSize: 20,
    rankingCategories: 94,
    searchEnabled: true,
  },
  scanning: {
    replyPagesPerVideo: 2,
    replyPageSize: 20,
    delayMs: 600,
    cursorDelayMs: 200,
    saveEvery: 100,
    emptyBackoffThreshold: 20,
    emptyBackoffMs: 15000,
  },
  analysis: {
    processed: 1,
    pending: 2,
    skippableNoText: 1,
    trainable: 1,
    userDbUsers: 2,
  },
  stats: {
    videosScanned: 2,
    uidsFound: 3,
    uidsAnalyzed: 1,
    commentsCollected: 4,
    errors: 0,
    videoQueueSize: 10,
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    saveEveryAnalyzed: 10,
    lockRetryDelayMs: 5000,
    lockRetryJitterMs: 2000,
    lockMaxRetries: 15,
  },
};

test('compareUidDiscoveryPlanObjects reports matching UID discovery summaries', () => {
  const result = compareUidDiscoveryPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidDiscoveryPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidDiscoveryPlan({
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

test('compareUidDiscoveryPlan delegates saved JS report comparison to Python contract', async () => {
  let compareContext;
  const jsReport = { ok: true, ...PLAN };
  const pythonReport = { ok: true, ...PLAN };
  const result = await compareUidDiscoveryPlan({
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

test('compareUidDiscoveryPlanSuite covers analysis resume, discovery start, and malformed numeric fixtures', async () => {
  const result = await compareUidDiscoveryPlanSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['analysis-resume', 'discovery-start', 'malformed-numeric-stats']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'discovery-start').python.resume.skipDiscovery, false);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'discovery-start').python.analysis.pending, 0);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'malformed-numeric-stats').python.stats.videosScanned, 12);
});

test('uidDiscoveryScrape can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-discovery-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          progress: { phase: 'analysis', scannedBvids: [], processedUids: {}, stats: {} },
          comments: { 42: [{ message: 'x' }] },
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
      join(fakeModuleDir, 'uid_discovery_plan.py'),
      'print(\'{"ok":true,"fromPythonUidDiscoveryPlan":true,"analysis":{"pending":42},"training":{"multiagent":true}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidDiscoveryScrape.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_DISCOVERY_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidDiscoveryPlan, true);
    assert.equal(payload.analysis.pending, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uidDiscoveryScrape accepts explicit python plan flag for dry-run planning', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-discovery-explicit-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ progress: { phase: 'analysis', scannedBvids: [], processedUids: {}, stats: {} }, comments: {}, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_discovery_plan.py'),
      'print(\'{"ok":true,"fromExplicitPythonUidDiscoveryPlan":true,"analysis":{"pending":7}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidDiscoveryScrape.js'), '--plan-json', '--python-plan', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromExplicitPythonUidDiscoveryPlan, true);
    assert.equal(payload.analysis.pending, 7);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
