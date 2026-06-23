import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareBatchUidScrapePlan, compareBatchUidScrapePlanObjects } from './compareBatchUidScrapePlan.js';

const PLAN = {
  discovery: {
    popularPages: 50,
    videosPerPage: 20,
    commentPagesPerVideo: 3,
    scannedBvids: 2,
    uidsDiscovered: 3,
  },
  phase2: {
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
  },
  training: {
    multiagent: true,
    existingTermsOnly: false,
    saveEveryAnalyzed: 10,
  },
  pacing: {
    delayBetweenVideosMs: 2000,
    lockRetryDelayMs: 10000,
    lockMaxRetries: 10,
  },
};

test('compareBatchUidScrapePlanObjects reports matching batch UID scrape summaries', () => {
  const result = compareBatchUidScrapePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchUidScrapePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchUidScrapePlan({
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

test('batchUidScrape can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-uid-scrape-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
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
      join(fakeModuleDir, 'batch_uid_scrape_plan.py'),
      'print(\'{"ok":true,"fromPythonBatchUidScrapePlan":true,"phase2":{"pending":42},"training":{"multiagent":true}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/batchUidScrape.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_BATCH_UID_SCRAPE_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchUidScrapePlan, true);
    assert.equal(payload.phase2.pending, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
