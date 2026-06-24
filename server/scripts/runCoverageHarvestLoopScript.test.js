import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { COVERAGE_LOOP_COMMAND_FIXTURES, compareCoverageHarvestLoopCommand } from './compareCoverageHarvestLoopCommand.js';
import { runCoverageLoopJsHarvestAdapter } from './runCoverageHarvestLoopJsAdapter.js';
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

test('runCoverageHarvestLoop.js passes live harvest adapter controls to Python command bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-live-bridge-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const reportPath = join(tempDir, 'report.json');
    const statePath = join(tempDir, 'state.json');
    const seenPath = join(tempDir, 'seen-request.json');
    const adapterPath = join(tempDir, 'adapter.mjs');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [{ term: 'doge', family: 'meme', evidenceCount: 0, evidenceSamples: [], evidenceSources: [] }],
      }),
      'utf8',
    );
    writeFileSync(
      adapterPath,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "writeFileSync(process.argv[3], JSON.stringify(request, null, 2));",
        "console.log(JSON.stringify({",
        "  afterDictionary: { version: 1, entries: [{",
        "    term: 'doge', family: 'meme', evidenceCount: 4,",
        "    evidenceSamples: ['doge hot', 'doge reply', 'doge source', 'doge danmaku'],",
        "    evidenceSources: [",
        "      { source: 'Bilibili public video comment scan', sample: 'doge hot' },",
        "      { source: 'Bilibili public video comment scan', sample: 'doge reply' },",
        "      { source: 'Bilibili public video comment scan', sample: 'doge source' },",
        "      { source: 'Bilibili public video comment scan', sample: 'doge danmaku' }",
        "    ]",
        "  }] },",
        "  harvest: { ok: true, rounds: [{",
        "    queries: ['doge 评论区 热评'], warnings: [],",
        "    coverageProgress: { evidenceGained: 4, zeroEvidenceResolved: 1, weakTermsResolved: 1 },",
        "    trainingDiagnostics: { accepted: 4 },",
        "    queryDiagnostics: [{ query: 'doge 评论区 热评', videos: 1 }]",
        "  }] }",
        "}));",
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON: JSON.stringify(['node', adapterPath, '{payload}', seenPath]),
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: statePath,
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '1',
        BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE: '2',
        BILIBILI_HARVEST_MAX_QUERIES: '5',
        BILIBILI_HARVEST_TARGET_EVIDENCE: '4',
        BILIBILI_COVERAGE_AUDIT_MIN_RATIO: '0.75',
        BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE: '0',
        BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES: '1',
        BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
        BILIBILI_HARVEST_INCLUDE_DANMAKU: '1',
        BILIBILI_HARVEST_RESET: '1',
        BILIBILI_HARVEST_SKIP_SEEN: '0',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    const seenRequest = JSON.parse(readFileSync(seenPath, 'utf8'));
    assert.equal(stdoutReport.runtimeMode, 'external_harvest_command');
    assert.equal(stdoutReport.stopReason, 'coverage_gate_passed');
    assert.deepEqual(fileReport, stdoutReport);
    assert.deepEqual(seenRequest.options, {
      rounds: 2,
      maxQueries: 5,
      targetEvidence: 4,
      maxActions: 5,
      minCoverageRatio: 0.75,
      requireComplete: false,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      includeDanmaku: true,
      resetState: true,
      skipSeen: false,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js forwards no-progress stop gate to Python command bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-no-progress-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const reportPath = join(tempDir, 'report.json');
    const statePath = join(tempDir, 'state.json');
    const seenPath = join(tempDir, 'seen-requests.json');
    const adapterPath = join(tempDir, 'adapter.mjs');
    const dictionary = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [{ term: 'doge', family: 'meme', evidenceCount: 0, evidenceSamples: [], evidenceSources: [] }],
    };
    writeFileSync(dictionaryPath, JSON.stringify(dictionary), 'utf8');
    writeFileSync(
      adapterPath,
      [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        "const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "const seenPath = process.argv[3];",
        "const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : [];",
        "seen.push({ cycle: request.cycle, options: request.options });",
        "writeFileSync(seenPath, JSON.stringify(seen, null, 2));",
        "console.log(JSON.stringify({",
        `  afterDictionary: ${JSON.stringify(dictionary)},`,
        "  harvest: { ok: true, rounds: [{",
        "    queries: ['doge retry'], warnings: ['no fresh evidence'],",
        "    coverageProgress: { evidenceGained: 0, zeroEvidenceResolved: 0, weakTermsResolved: 0 },",
        "    trainingDiagnostics: { accepted: 0 },",
        "    queryDiagnostics: [{ query: 'doge retry', videos: 0 }]",
        "  }] }",
        "}));",
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON: JSON.stringify(['node', adapterPath, '{payload}', seenPath]),
        BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS: '1',
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: statePath,
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '2',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    const seenRequests = JSON.parse(readFileSync(seenPath, 'utf8'));
    assert.equal(stdoutReport.runtimeMode, 'external_harvest_command');
    assert.equal(stdoutReport.stopReason, 'no_coverage_progress');
    assert.equal(stdoutReport.cycles.length, 1);
    assert.deepEqual(seenRequests.map((item) => item.cycle), [1]);
    assert.deepEqual(fileReport, stdoutReport);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js keeps no-queries stop parity in Python command bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-no-queries-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const reportPath = join(tempDir, 'report.json');
    const statePath = join(tempDir, 'state.json');
    const seenPath = join(tempDir, 'seen-requests.json');
    const adapterPath = join(tempDir, 'adapter.mjs');
    const dictionary = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [{ term: 'doge', family: 'meme', evidenceCount: 0, evidenceSamples: [], evidenceSources: [] }],
    };
    writeFileSync(dictionaryPath, JSON.stringify(dictionary), 'utf8');
    writeFileSync(
      adapterPath,
      [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        "const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "const seenPath = process.argv[3];",
        "const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : [];",
        "seen.push({ cycle: request.cycle, options: request.options });",
        "writeFileSync(seenPath, JSON.stringify(seen, null, 2));",
        "console.log(JSON.stringify({",
        `  afterDictionary: ${JSON.stringify(dictionary)},`,
        "  harvest: { ok: true, rounds: [{",
        "    queries: [], warnings: ['all candidate queries skipped'],",
        "    coverageProgress: { evidenceGained: 0 },",
        "    trainingDiagnostics: { accepted: 0 },",
        "    queryDiagnostics: []",
        "  }] }",
        "}));",
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON: JSON.stringify(['node', adapterPath, '{payload}', seenPath]),
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: statePath,
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '2',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    const seenRequests = JSON.parse(readFileSync(seenPath, 'utf8'));
    assert.equal(stdoutReport.runtimeMode, 'external_harvest_command');
    assert.equal(stdoutReport.stopReason, 'no_queries_run');
    assert.equal(stdoutReport.cycles.length, 1);
    assert.deepEqual(stdoutReport.cycles[0].harvest.queries, []);
    assert.deepEqual(seenRequests.map((item) => item.cycle), [1]);
    assert.deepEqual(fileReport, stdoutReport);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js keeps adapter crash report parity in Python command bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-adapter-crash-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const reportPath = join(tempDir, 'report.json');
    const statePath = join(tempDir, 'state.json');
    const adapterPath = join(tempDir, 'adapter.mjs');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [{ term: 'doge', family: 'meme', evidenceCount: 0, evidenceSamples: [], evidenceSources: [] }],
      }),
      'utf8',
    );
    writeFileSync(
      adapterPath,
      [
        "console.error('adapter boom');",
        "process.exit(2);",
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON: JSON.stringify(['node', adapterPath, '{payload}']),
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: statePath,
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '2',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const fileReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(stdoutReport.runtimeMode, 'external_harvest_command');
    assert.equal(stdoutReport.stopReason, 'cycle_1_crashed');
    assert.equal(stdoutReport.cycles.length, 1);
    assert.equal(stdoutReport.cycles[0].harvest.ok, false);
    assert.match(stdoutReport.cycles[0].harvest.warnings[0], /adapter boom/);
    assert.deepEqual(fileReport, stdoutReport);
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
  assert.deepEqual(COVERAGE_LOOP_COMMAND_FIXTURES.map((fixture) => fixture.name), [
    'complete-empty-dictionary',
    'weak-cycle-limit',
    'python-deferred-live-contract',
    'mock-cycle-report',
    'mock-no-progress-cycle',
    'mock-multi-cycle-report',
    'file-backed-mock-harvest',
    'external-harvest-command',
    'js-harvest-adapter-command',
  ]);

  const result = await compareCoverageHarvestLoopCommand();

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 9);
  assert.deepEqual(result.results.map((item) => item.fixture), [
    'complete-empty-dictionary',
    'weak-cycle-limit',
    'python-deferred-live-contract',
    'mock-cycle-report',
    'mock-no-progress-cycle',
    'mock-multi-cycle-report',
    'file-backed-mock-harvest',
    'external-harvest-command',
    'js-harvest-adapter-command',
  ]);
  assert.deepEqual(result.results.map((item) => item.python.stopReason), [
    'coverage_gate_passed',
    'cycle_limit',
    'live_harvest_not_implemented',
    'coverage_gate_passed',
    'no_coverage_progress',
    'coverage_gate_passed',
    'coverage_gate_passed',
    'coverage_gate_passed',
    'coverage_gate_passed',
  ]);
  assert.deepEqual(result.results.map((item) => item.python.finalAudit.coverage.weakTerms), [0, 1, 1, 0, 1, 0, 0, 0, 0]);
  assert.equal(result.results[2].python.runtimeMode, 'deferred_live_harvest');
  assert.deepEqual(result.results[2].python.replacementBlockers.map((item) => item.blocker), ['live_harvest_runtime_not_integrated']);
  assert.deepEqual(result.results[3].python.cycles[0].coverageDelta, result.results[3].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[3].python.cycles[0].harvest, result.results[3].js.cycles[0].harvest);
  assert.deepEqual(result.results[4].python.cycles[0].coverageDelta, {
    evidenceDeficitReduced: 0,
    zeroEvidenceResolved: 0,
    weakTermsResolved: 0,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 0,
    termsAdded: 0,
    coverageRatioDelta: 0,
  });
  assert.deepEqual(result.results[4].python.cycles[0].coverageDelta, result.results[4].js.cycles[0].coverageDelta);
  assert.equal(result.results[5].python.cycles.length, 2);
  assert.deepEqual(result.results[5].python.cycles.map((cycle) => cycle.coverageDelta), result.results[5].js.cycles.map((cycle) => cycle.coverageDelta));
  assert.deepEqual(result.results[5].python.cycles[1].harvest.warnings, ['retry source']);
  assert.deepEqual(result.results[5].pythonReportFile, result.results[5].python);
  assert.deepEqual(result.results[5].pythonReportFile, result.results[5].js);
  assert.deepEqual(result.results[6].python.cycles[0].coverageDelta, result.results[6].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[6].python.cycles[0].priorityQueries.map((item) => item.term), ['doge']);
  assert.deepEqual(result.results[6].pythonReportFile, result.results[6].python);
  assert.equal(result.results[7].python.runtimeMode, 'external_harvest_command');
  assert.deepEqual(result.results[7].python.cycles[0].coverageDelta, result.results[7].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[7].python.cycles[0].harvest, result.results[7].js.cycles[0].harvest);
  assert.deepEqual(result.results[7].pythonReportFile, result.results[7].python);
  assert.equal(result.results[8].python.runtimeMode, 'external_harvest_command');
  assert.deepEqual(result.results[8].python.cycles[0].coverageDelta, result.results[8].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[8].python.cycles[0].harvest, result.results[8].js.cycles[0].harvest);
  assert.deepEqual(result.results[8].pythonReportFile, result.results[8].python);
});

test('runCoverageHarvestLoopJsAdapter maps Python loop request to JS harvest contract', async () => {
  const calls = [];
  const result = await runCoverageLoopJsHarvestAdapter(
    {
      dictionaryPath: 'tmp/dictionary.json',
      statePath: 'tmp/state.json',
      priorityQueries: [{ term: 'doge', query: 'doge 评论区 热评' }],
      options: {
        rounds: 2,
        maxQueries: 3,
        targetEvidence: 4,
        requireSourceBackedEvidence: true,
        requireCommentBackedEvidence: true,
        includeDanmaku: true,
        resetState: true,
        skipSeen: false,
      },
    },
    {
      harvestKeywordDictionaryRounds: async (options) => {
        calls.push(options);
        return {
          ok: true,
          rounds: [{ queries: ['doge 评论区 热评'], warnings: [], coverageProgress: { evidenceGained: 4 } }],
          dictionary: { version: 1, entries: [{ term: 'doge', family: 'meme', evidenceCount: 4 }] },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.afterDictionary.entries.map((entry) => entry.term), ['doge']);
  assert.deepEqual(result.harvest.rounds[0].queries, ['doge 评论区 热评']);
  assert.equal(calls[0].dictionaryPath, 'tmp/dictionary.json');
  assert.equal(calls[0].statePath, 'tmp/state.json');
  assert.equal(calls[0].rounds, 2);
  assert.equal(calls[0].maxQueries, 3);
  assert.equal(calls[0].targetEvidence, 4);
  assert.equal(calls[0].requireSourceBackedEvidence, true);
  assert.equal(calls[0].requireCommentBackedEvidence, true);
  assert.equal(calls[0].includeDanmaku, true);
  assert.equal(calls[0].resetState, true);
  assert.equal(calls[0].skipSeen, false);
  assert.deepEqual(calls[0].priorityQueries, [{ term: 'doge', query: 'doge 评论区 热评' }]);
});
