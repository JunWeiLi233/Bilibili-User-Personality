import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { compareHarvestPlan, compareHarvestPlanObjects } from './compareHarvestPlan.js';

const PLAN = {
  queries: ['fresh query', 'missed query'],
  plan: [
    { query: 'fresh query', source: 'dictionary', term: 'fresh', family: 'attack' },
    { query: 'missed query', source: 'dictionary', term: 'missed', family: 'attack' },
  ],
};

test('compareHarvestPlanObjects reports matching query-plan summaries', () => {
  const result = compareHarvestPlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareHarvestPlan compares JS and Python dry-run query plans', async () => {
  const calls = [];
  const result = await compareHarvestPlan({
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

test('runVideoKeywordDiscovery can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harvest-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const fakeModuleDir = join(tempDir, 'python_backend', 'cli');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          dictionary: { entries: [{ term: 'fresh', family: 'attack', evidenceCount: 0 }] },
          options: { maxQueries: 1 },
        },
        null,
        2,
      ),
      'utf8',
    );
    mkdirSync(fakeModuleDir, { recursive: true });
    writeFileSync(join(tempDir, 'python_backend', '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, '__init__.py'), '', 'utf8');
    writeFileSync(join(fakeModuleDir, 'harvest_plan.py'), 'print(\'{"ok":true,"fromPythonHarvestPlan":true,"queries":["sentinel query"],"plan":[]}\')\n', 'utf8');

    const result = spawnSync('node', [resolve('server/scripts/runVideoKeywordDiscovery.js'), '--plan-json', '--payload', payloadPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        BILIBILI_HARVEST_USE_PYTHON_PLAN: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.fromPythonHarvestPlan, true);
    assert.deepEqual(payload.queries, ['sentinel query']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
