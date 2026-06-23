import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareUidRangeScrapePlan, compareUidRangeScrapePlanObjects, compareUidRangeScrapePlanSuite } from './compareUidRangeScrapePlan.js';

const PLAN = {
  range: { start: 10, end: 12, total: 3, progressFile: 'custom-progress.json' },
  resume: { processed: 2, userDbUsers: 1 },
  collection: { videosPerUser: 3, commentPagesPerVideo: 1 },
  stats: { success: 1, noComments: 1, noVideos: 0, errors: 0, blocked: 0 },
  pacing: { delayBetweenUidsMs: 2500, delayBetweenRequestsMs: 800, saveEvery: 20, blockBackoffMs: 30000 },
  training: { multiagent: true, existingTermsOnly: false, lockRetryDelayMs: 10000, lockMaxRetries: 10 },
};

test('compareUidRangeScrapePlanObjects reports matching UID range scrape plans', () => {
  const result = compareUidRangeScrapePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareUidRangeScrapePlan compares JS and Python dry-run plans', async () => {
  const calls = [];
  const result = await compareUidRangeScrapePlan({
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

test('compareUidRangeScrapePlanSuite covers custom progress, default range, and malformed stats fixtures', async () => {
  const result = await compareUidRangeScrapePlanSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['custom-progress-resume', 'default-range-empty', 'malformed-progress-stats']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'default-range-empty').python.range.progressFile, 'uid-range-progress-1-100000.json');
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'malformed-progress-stats').python.stats.success, 12);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'malformed-progress-stats').python.stats.blocked, 5);
});

test('uidRangeScrape can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'uid-range-scrape-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify({ argv: ['--start=10', '--end=12'], progress: { processed: {} }, database: { users: {} } }, null, 2),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(
      join(fakeModuleDir, 'uid_range_scrape_plan.py'),
      'print(\'{"ok":true,"fromPythonUidRangeScrapePlan":true,"range":{"start":10,"end":12},"resume":{"processed":42}}\')\n',
      'utf8',
    );

    const result = spawnSync('node', [resolve('server/scripts/uidRangeScrape.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_UID_RANGE_SCRAPE_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonUidRangeScrapePlan, true);
    assert.equal(payload.resume.processed, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
