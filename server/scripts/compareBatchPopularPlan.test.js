import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareBatchPopularPlan, compareBatchPopularPlanObjects } from './compareBatchPopularPlan.js';

const PLAN = {
  input: {
    maxPages: 8,
  },
  range: {
    startPage: 4,
    maxPages: 8,
    remainingPages: 5,
  },
  progress: {
    pagesScanned: 3,
    videosScanned: 20,
    scraped: 4,
  },
  database: {
    users: 2,
  },
  limits: {
    popularPageSize: 20,
    replyPagesPerVideo: 10,
    replyPageSize: 20,
  },
  pacing: {
    delayMs: 3000,
    delayAfterLimitMs: 60000,
    maxRetries: 5,
  },
  retry: {
    rateLimitCodes: [-799, -412],
    htmlWafDetection: true,
    hasUserAgent: true,
    referer: 'https://www.bilibili.com/',
  },
  collection: {
    storesTopLevelReplies: true,
    storesNestedReplies: true,
    dedupesByRpid: true,
    updatesCombinedTextFromComments: true,
  },
  sampleRequests: {
    popularUrl: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=4',
    replyUrl: 'https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1',
  },
};

test('compareBatchPopularPlanObjects reports matching batch popular summaries', () => {
  const result = compareBatchPopularPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareBatchPopularPlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareBatchPopularPlan({
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

test('batchScrapePopular can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-popular-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          argv: ['--pages=2'],
          progress: { pagesScanned: 0, videosScanned: 0, scraped: 0 },
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
    writeFileSync(join(fakeModuleDir, 'batch_popular_plan.py'), 'print(\'{"ok":true,"fromPythonBatchPopularPlan":true,"range":{"startPage":42,"maxPages":42,"remainingPages":1}}\')\n', 'utf8');

    const result = spawnSync('node', [resolve('server/scripts/batchScrapePopular.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_POPULAR_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonBatchPopularPlan, true);
    assert.equal(payload.range.startPage, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
