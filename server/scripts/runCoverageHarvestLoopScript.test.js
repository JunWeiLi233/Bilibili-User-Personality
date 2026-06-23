import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareCoverageHarvestLoopCommand } from './compareCoverageHarvestLoopCommand.js';
import { compareCoverageHarvestLoopPlanObjects } from './compareCoverageHarvestLoopPlan.js';

test('runCoverageHarvestLoop.js forces auto coverage to DeepSeek v4 flash max effort', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-script-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [],
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: join(tempDir, 'state.json'),
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: join(tempDir, 'report.json'),
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
        DEEPSEEK_MODEL: 'deepseek-v4-pro',
        DEEPSEEK_REASONING_EFFORT: 'medium',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DeepSeek model: deepseek-v4-flash/);
    assert.match(result.stdout, /DeepSeek reasoning effort: max/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js emits JS/Python comparable dry-run plan without harvesting', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-plan-script-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify({
        env: {
          BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
          BILIBILI_HARVEST_MAX_QUERIES: '2',
          BILIBILI_VIDEO_SEARCH_QUERY: 'doge, tieba',
        },
        audit: {
          ok: false,
          nextActions: [
            { term: 'doge', family: 'meme', nextQuery: 'doge hot', suggestedQueries: ['doge comments'] },
          ],
        },
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js', '--plan-json', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, BILIBILI_HARVEST_MAX_QUERIES: '99' },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.loop, { maxCycles: 0, roundsPerCycle: 1, maxQueries: 2 });
    assert.deepEqual(plan.lists.seedQueries, ['doge', 'tieba']);
    assert.deepEqual(plan.priorityQueries.map((item) => item.query), ['doge hot', 'doge comments']);
    assert.equal(plan.initialStopReason, 'cycle_limit');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js can delegate dry-run plan JSON to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-plan-script-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify({
        env: {
          BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
          BILIBILI_HARVEST_MAX_QUERIES: '2',
          BILIBILI_VIDEO_SEARCH_QUERY: 'doge, tieba',
        },
        audit: {
          ok: false,
          nextActions: [{ term: 'doge', family: 'meme', nextQuery: 'doge hot' }],
        },
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js', '--plan-json', '--python-plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, BILIBILI_HARVEST_MAX_QUERIES: '99' },
      encoding: 'utf8',
    });
    const python = spawnSync('python', ['-m', 'python_backend.cli.coverage_loop_plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(python.status, 0, python.stderr);
    const plan = JSON.parse(result.stdout);
    const pythonPlan = JSON.parse(python.stdout);
    assert.deepEqual(plan, pythonPlan);
    assert.deepEqual(plan.priorityQueries.map((item) => item.query), ['doge hot']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js can delegate coverage progress JSON to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-progress-script-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify({
        before: { totalEvidence: 10, evidenceDeficit: 5, zeroEvidenceTerms: 2, weakTerms: 4 },
        after: { totalEvidence: 12, evidenceDeficit: 3, zeroEvidenceTerms: 1, weakTerms: 3 },
        harvestProgress: [{ weakTermsResolved: 0, zeroEvidenceResolved: 1, evidenceGained: 2, evidenceDeficitReduced: 2 }],
      }),
      'utf8',
    );
    const dictionaryPath = join(tempDir, 'dictionary.json');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [],
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js', '--coverage-progress-json', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: join(tempDir, 'state.json'),
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: join(tempDir, 'report.json'),
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const progress = JSON.parse(result.stdout);
    assert.equal(progress.ok, true);
    assert.equal(progress.hasHarvestProgress, true);
    assert.deepEqual(progress.harvestDelta, {
      evidenceDeficitReduced: 2,
      zeroEvidenceResolved: 1,
      weakTermsResolved: 1,
      unsourcedEvidenceReduced: 0,
      totalEvidenceGained: 2,
      termsAdded: 0,
      coverageRatioDelta: 0,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js can delegate no-live command runtime to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-command-script-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const reportPath = join(tempDir, 'report.json');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [],
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: join(tempDir, 'state.json'),
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(stdoutReport.stopReason, 'coverage_gate_passed');
    assert.equal(stdoutReport.finalOk, true);
    assert.deepEqual(fileReport, stdoutReport);
    assert.deepEqual(stdoutReport.cycles, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('compareCoverageHarvestLoopPlanObjects reports matching dry-run plans', () => {
  const plan = {
    deepseek: { model: 'deepseek-v4-flash' },
    paths: { reportPath: 'server/data/report.json' },
    loop: { maxCycles: 0 },
    auditOptions: { targetEvidence: 3 },
    harvestOptions: { maxQueries: 2 },
    lists: { seedQueries: ['doge'] },
    prune: { pruneExhaustedAfter: 0 },
    strict: false,
    priorityQueries: [{ query: 'doge hot' }],
    initialStopReason: 'cycle_limit',
    ignored: true,
  };

  const result = compareCoverageHarvestLoopPlanObjects(plan, { ...plan, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.ignored, undefined);
  assert.equal(result.js.ignored, undefined);
});

test('compareCoverageHarvestLoopCommand validates complete and weak no-live fixtures', async () => {
  const result = await compareCoverageHarvestLoopCommand();

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 5);
  assert.deepEqual(result.results.map((item) => item.fixture), [
    'complete-empty-dictionary',
    'weak-cycle-limit',
    'mock-cycle-report',
    'mock-no-progress-cycle',
    'mock-multi-cycle-report',
  ]);
  assert.deepEqual(result.results.map((item) => item.python.stopReason), [
    'coverage_gate_passed',
    'cycle_limit',
    'coverage_gate_passed',
    'no_coverage_progress',
    'coverage_gate_passed',
  ]);
  assert.deepEqual(result.results.map((item) => item.python.finalAudit.coverage.weakTerms), [0, 1, 0, 1, 0]);
  assert.deepEqual(result.results[2].python.cycles[0].coverageDelta, result.results[2].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[2].python.cycles[0].harvest, result.results[2].js.cycles[0].harvest);
  assert.deepEqual(result.results[3].python.cycles[0].coverageDelta, {
    evidenceDeficitReduced: 0,
    zeroEvidenceResolved: 0,
    weakTermsResolved: 0,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 0,
    termsAdded: 0,
    coverageRatioDelta: 0,
  });
  assert.deepEqual(result.results[3].python.cycles[0].coverageDelta, result.results[3].js.cycles[0].coverageDelta);
  assert.equal(result.results[4].python.cycles.length, 2);
  assert.deepEqual(result.results[4].python.cycles.map((cycle) => cycle.coverageDelta), result.results[4].js.cycles.map((cycle) => cycle.coverageDelta));
  assert.deepEqual(result.results[4].python.cycles[1].harvest.warnings, ['retry source']);
  assert.deepEqual(result.results[4].pythonReportFile, result.results[4].python);
  assert.deepEqual(result.results[4].pythonReportFile, result.results[4].js);
});
