import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { COVERAGE_LOOP_COMMAND_FIXTURES, compareCoverageHarvestLoopCommand } from './compareCoverageHarvestLoopCommand.js';
import { runCoverageLoopJsHarvestAdapter } from './runCoverageHarvestLoopJsAdapter.js';
import { compareCoverageHarvestLoopPlan, compareCoverageHarvestLoopPlanObjects } from './compareCoverageHarvestLoopPlan.js';
import { buildPythonCoverageLoopCommandArgs } from './runCoverageHarvestLoop.js';

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

test('runCoverageHarvestLoop.js can delegate command runtime to Python with CLI flag', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-command-flag-'));
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

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js', '--python-command'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
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
    assert.equal(stdoutReport.runtimeMode, 'no_live_audit_gate');
    assert.equal(stdoutReport.stopReason, 'coverage_gate_passed');
    assert.equal(stdoutReport.finalOk, true);
    assert.deepEqual(fileReport, stdoutReport);
    assert.deepEqual(stdoutReport.cycles, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCoverageHarvestLoop.js builds standalone Python discovery CLI args', () => {
  const args = buildPythonCoverageLoopCommandArgs({
    dictionaryPath: 'dictionary.json',
    statePath: 'state.json',
    reportPath: 'report.json',
    maxCycles: 1,
    roundsPerCycle: 2,
    maxQueries: 5,
    targetEvidence: 4,
    maxActions: 5,
    minCoverageRatio: 0.75,
    requireComplete: false,
    seedQueries: ['alpha seed', 'beta seed'],
    controversyQueries: ['drama seed'],
    discoveryMode: 'popular',
    termsPerFamily: 6,
    queryVariantsPerTerm: 5,
    extraQueryTemplates: ['{term} review'],
    exhaustedSuggestionTemplates: ['{term} retry'],
    discoveryLimit: 9,
    discoveryPages: 2,
    includeGenericPopular: true,
    maxHardMissedQueries: 8,
    staleMissedDiscoveryLimit: 7,
    staleMissedPages: 5,
    coverageMode: 'missing-source',
    commentPoolTargetTermsLimit: 41,
    priorityCommentPoolTargets: true,
    preFilterCommentsToTargets: true,
    deepenReplyThreads: true,
    verbose: false,
    prioritizeNearTarget: true,
    existingTermsOnly: true,
    controversialPopularQueryLimit: 9,
    controversialPopularSearchOrder: 'pubdate',
    pages: 4,
    perQueryTimeoutMs: 120000,
    expandTargetsFromComments: true,
    strict: false,
  });

  assert.deepEqual(args.slice(0, 2), ['-m', 'python_backend.cli.coverage_loop_command']);
  assert.deepEqual(args.slice(args.indexOf('--seed-query'), args.indexOf('--seed-query') + 4), [
    '--seed-query',
    'alpha seed',
    '--seed-query',
    'beta seed',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--controversy-query'), args.indexOf('--controversy-query') + 2), [
    '--controversy-query',
    'drama seed',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--discovery-mode'), args.indexOf('--discovery-mode') + 2), ['--discovery-mode', 'popular']);
  assert.deepEqual(args.slice(args.indexOf('--terms-per-family'), args.indexOf('--terms-per-family') + 2), ['--terms-per-family', '6']);
  assert.deepEqual(args.slice(args.indexOf('--query-variants-per-term'), args.indexOf('--query-variants-per-term') + 2), [
    '--query-variants-per-term',
    '5',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--extra-query-template'), args.indexOf('--extra-query-template') + 2), [
    '--extra-query-template',
    '{term} review',
  ]);
  assert.deepEqual(
    args.slice(args.indexOf('--exhausted-suggestion-template'), args.indexOf('--exhausted-suggestion-template') + 2),
    ['--exhausted-suggestion-template', '{term} retry'],
  );
  assert.deepEqual(args.slice(args.indexOf('--discovery-limit'), args.indexOf('--discovery-limit') + 2), ['--discovery-limit', '9']);
  assert.deepEqual(args.slice(args.indexOf('--discovery-pages'), args.indexOf('--discovery-pages') + 2), ['--discovery-pages', '2']);
  assert.ok(args.includes('--include-generic-popular'));
  assert.deepEqual(args.slice(args.indexOf('--max-hard-missed-queries'), args.indexOf('--max-hard-missed-queries') + 2), [
    '--max-hard-missed-queries',
    '8',
  ]);
  assert.deepEqual(
    args.slice(args.indexOf('--stale-missed-discovery-limit'), args.indexOf('--stale-missed-discovery-limit') + 2),
    ['--stale-missed-discovery-limit', '7'],
  );
  assert.deepEqual(args.slice(args.indexOf('--stale-missed-pages'), args.indexOf('--stale-missed-pages') + 2), [
    '--stale-missed-pages',
    '5',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--coverage-mode'), args.indexOf('--coverage-mode') + 2), [
    '--coverage-mode',
    'missing-source',
  ]);
  assert.deepEqual(
    args.slice(args.indexOf('--comment-pool-target-limit'), args.indexOf('--comment-pool-target-limit') + 2),
    ['--comment-pool-target-limit', '41'],
  );
  assert.ok(args.includes('--priority-comment-pool-targets'));
  assert.ok(args.includes('--pre-filter-comments-to-targets'));
  assert.ok(args.includes('--deepen-reply-threads'));
  assert.ok(args.includes('--quiet'));
  assert.ok(args.includes('--prioritize-near-target'));
  assert.ok(args.includes('--existing-terms-only'));
  assert.deepEqual(
    args.slice(args.indexOf('--controversial-popular-query-limit'), args.indexOf('--controversial-popular-query-limit') + 2),
    ['--controversial-popular-query-limit', '9'],
  );
  assert.deepEqual(
    args.slice(args.indexOf('--controversial-popular-search-order'), args.indexOf('--controversial-popular-search-order') + 2),
    ['--controversial-popular-search-order', 'pubdate'],
  );
  assert.deepEqual(args.slice(args.indexOf('--pages'), args.indexOf('--pages') + 2), ['--pages', '4']);
  assert.deepEqual(args.slice(args.indexOf('--per-query-timeout-ms'), args.indexOf('--per-query-timeout-ms') + 2), [
    '--per-query-timeout-ms',
    '120000',
  ]);
  assert.ok(args.includes('--expand-targets-from-comments'));
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
        BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES: '8',
        BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT: '7',
        BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES: '5',
        BILIBILI_HARVEST_COVERAGE_MODE: 'missing-source',
        BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT: '41',
        BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS: '1',
        BILIBILI_HARVEST_PREFILTER_COMMENTS: '1',
        BILIBILI_HARVEST_DEEPEN_REPLIES: '1',
        BILIBILI_HARVEST_VERBOSE: '0',
        BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET: '1',
        BILIBILI_HARVEST_EXISTING_TERMS_ONLY: '1',
        BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT: '9',
        BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER: 'pubdate',
        BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS: '1',
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
      prioritizeSourceGaps: true,
      retryBeforeUnattemptedLimit: 1,
      includeDanmaku: true,
      resetState: true,
      skipSeen: false,
      seedQueries: [],
      controversyQueries: [],
      discoveryMode: 'controversial',
      termsPerFamily: 4,
      queryVariantsPerTerm: 2,
      extraQueryTemplates: [],
      exhaustedSuggestionTemplates: [],
      maxHardMissedQueries: 8,
      staleMissedDiscoveryLimit: 7,
      staleMissedPages: 5,
      coverageMode: 'missing-source',
      commentPoolTargetTermsLimit: 41,
      priorityCommentPoolTargets: true,
      preFilterCommentsToTargets: true,
      deepenReplyThreads: true,
      verbose: false,
      prioritizeNearTarget: true,
      existingTermsOnly: true,
      discoveryLimit: 6,
      discoveryPages: 1,
      controversialPopularQueryLimit: 9,
      controversialPopularSearchOrder: 'pubdate',
      includeGenericPopular: false,
      pages: 2,
      perQueryTimeoutMs: 180000,
      expandTargetsFromComments: true,
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

test('runCoverageHarvestLoop.js passes exhausted prune controls to Python command bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-python-prune-bridge-'));
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
        entries: [
          { term: 'doge', family: 'meme', evidenceCount: 1, evidenceSamples: ['partial'], evidenceSources: ['Bilibili comments'] },
          { term: 'keep', family: 'meme', evidenceCount: 3, evidenceSamples: ['a', 'b', 'c'], evidenceSources: ['Bilibili comments'] },
        ],
      }),
      'utf8',
    );
    writeFileSync(statePath, JSON.stringify({ termAttempts: { doge: { attempts: 2 } } }), 'utf8');
    writeFileSync(
      adapterPath,
      [
        "import { readFileSync } from 'node:fs';",
        'const request = JSON.parse(readFileSync(process.argv[2], "utf8"));',
        'const dictionary = JSON.parse(readFileSync(request.dictionaryPath, "utf8"));',
        'console.log(JSON.stringify({ afterDictionary: dictionary, harvest: { ok: true, rounds: [{ queries: ["doge retry"], warnings: [], coverageProgress: { evidenceGained: 0 }, trainingDiagnostics: {}, queryDiagnostics: [] }] } }));',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND: '1',
        BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON: JSON.stringify(['node', adapterPath, '{payload}']),
        BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER: '2',
        BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL: '1',
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: statePath,
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '1',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    const writtenDictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8'));
    assert.equal(stdoutReport.runtimeMode, 'external_harvest_command');
    assert.equal(stdoutReport.stopReason, 'coverage_gate_passed');
    assert.deepEqual(writtenDictionary.entries.map((entry) => entry.term), ['keep']);
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

test('compareCoverageHarvestLoopPlan delegates persisted plan comparison to Python contract', async () => {
  const calls = [];
  const result = await compareCoverageHarvestLoopPlan({
    payload: { env: { BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0' }, audit: { ok: true } },
    runJs: async () => ({ ok: true, loop: { maxCycles: 0 }, initialStopReason: 'coverage_gate_passed' }),
    runPython: async () => ({ ok: true, loop: { maxCycles: 0 }, initialStopReason: 'coverage_gate_passed' }),
    runCompare: async (context) => {
      calls.push({
        pythonStopReason: context.pythonPlan.initialStopReason,
        jsStopReason: context.jsPlan.initialStopReason,
        hasPayloadPath: context.payloadPath.endsWith('payload.json'),
        hasJsPlanPath: context.jsPlanPath.endsWith('js-plan.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }]);
  assert.deepEqual(calls, [
    {
      pythonStopReason: 'coverage_gate_passed',
      jsStopReason: 'coverage_gate_passed',
      hasPayloadPath: true,
      hasJsPlanPath: true,
    },
  ]);
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
    'external-prune-command',
    'js-harvest-adapter-command',
  ]);

  const result = await compareCoverageHarvestLoopCommand();

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 10);
  assert.deepEqual(result.results.map((item) => item.fixture), [
    'complete-empty-dictionary',
    'weak-cycle-limit',
    'python-deferred-live-contract',
    'mock-cycle-report',
    'mock-no-progress-cycle',
    'mock-multi-cycle-report',
    'file-backed-mock-harvest',
    'external-harvest-command',
    'external-prune-command',
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
    'coverage_gate_passed',
  ]);
  assert.deepEqual(result.results.map((item) => item.python.finalAudit.coverage.weakTerms), [0, 1, 1, 0, 1, 0, 0, 0, 0, 0]);
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
  assert.deepEqual(result.results[8].python.finalAudit.coverage, result.results[8].js.finalAudit.coverage);
  assert.deepEqual(result.results[8].pythonReportFile, result.results[8].python);
  assert.equal(result.results[9].python.runtimeMode, 'external_harvest_command');
  assert.deepEqual(result.results[9].python.cycles[0].coverageDelta, result.results[9].js.cycles[0].coverageDelta);
  assert.deepEqual(result.results[9].python.cycles[0].harvest, result.results[9].js.cycles[0].harvest);
  assert.deepEqual(result.results[9].pythonReportFile, result.results[9].python);
});

test('compareCoverageHarvestLoopCommand delegates persisted report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareCoverageHarvestLoopCommand({
    fixtures: [{ name: 'delegated-compare', dictionary: { version: 1, entries: [] } }],
    runJs: async () => ({
      maxCycles: 0,
      roundsPerCycle: 1,
      stopReason: 'coverage_gate_passed',
      finalOk: true,
      cycles: [],
      finalAudit: { coverage: { terms: 0, weakTerms: 0, zeroEvidenceTerms: 0 }, recommendedQueries: [] },
    }),
    runPython: async () => ({
      maxCycles: 0,
      roundsPerCycle: 1,
      stopReason: 'coverage_gate_passed',
      finalOk: true,
      cycles: [],
      finalAudit: { coverage: { terms: 0, weakTerms: 0, zeroEvidenceTerms: 0 }, recommendedQueries: [] },
    }),
    runCompare: async (context) => {
      calls.push({
        fixture: context.fixtureName,
        pythonStopReason: context.pythonReport.stopReason,
        jsStopReason: context.jsReport.stopReason,
        hasPythonReportPath: context.pythonReportPath.endsWith('report-python.json'),
        hasJsReportPath: context.jsReportPath.endsWith('report-js.json'),
        hasCompareJsReportPath: context.compareJsReportPath.endsWith('report-js.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ fixture: 'delegated-compare', key: 'delegated', python: 'python-contract', js: 'js-bridge' }]);
  assert.deepEqual(calls, [
    {
      fixture: 'delegated-compare',
      pythonStopReason: 'coverage_gate_passed',
      jsStopReason: 'coverage_gate_passed',
      hasPythonReportPath: true,
      hasJsReportPath: true,
      hasCompareJsReportPath: true,
    },
  ]);
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
        prioritizeSourceGaps: true,
        retryBeforeUnattemptedLimit: 5,
        includeDanmaku: true,
        resetState: true,
        skipSeen: false,
        seedQueries: ['热评', '翻车'],
        controversyQueries: ['争议', '开团'],
        discoveryMode: 'popular',
        includeGenericPopular: true,
        pages: 4,
        perQueryTimeoutMs: 90000,
        expandTargetsFromComments: true,
        termsPerFamily: 7,
        queryVariantsPerTerm: 6,
        extraQueryTemplates: ['{term} review', '{term} danmaku'],
        exhaustedSuggestionTemplates: ['{term} retry', '{term} archive'],
        maxHardMissedQueries: 9,
        staleMissedDiscoveryLimit: 8,
        staleMissedPages: 5,
        coverageMode: 'missing-source',
        commentPoolTargetTermsLimit: 42,
        priorityCommentPoolTargets: true,
        preFilterCommentsToTargets: true,
        deepenReplyThreads: true,
        verbose: false,
        prioritizeNearTarget: true,
        existingTermsOnly: true,
        discoveryLimit: 11,
        discoveryPages: 3,
        controversialPopularQueryLimit: 10,
        controversialPopularSearchOrder: 'pubdate',
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
  assert.equal(calls[0].prioritizeSourceGaps, true);
  assert.equal(calls[0].retryBeforeUnattemptedLimit, 5);
  assert.equal(calls[0].includeDanmaku, true);
  assert.equal(calls[0].resetState, true);
  assert.equal(calls[0].skipSeen, false);
  assert.deepEqual(calls[0].seedQueries, ['热评', '翻车']);
  assert.deepEqual(calls[0].controversyQueries, ['争议', '开团']);
  assert.equal(calls[0].discoveryMode, 'popular');
  assert.equal(calls[0].includeGenericPopular, true);
  assert.equal(calls[0].pages, 4);
  assert.equal(calls[0].perQueryTimeoutMs, 90000);
  assert.equal(calls[0].expandTargetsFromComments, true);
  assert.equal(calls[0].termsPerFamily, 7);
  assert.equal(calls[0].queryVariantsPerTerm, 6);
  assert.deepEqual(calls[0].extraQueryTemplates, ['{term} review', '{term} danmaku']);
  assert.deepEqual(calls[0].exhaustedSuggestionTemplates, ['{term} retry', '{term} archive']);
  assert.equal(calls[0].maxHardMissedQueries, 9);
  assert.equal(calls[0].staleMissedDiscoveryLimit, 8);
  assert.equal(calls[0].staleMissedPages, 5);
  assert.equal(calls[0].coverageMode, 'missing-source');
  assert.equal(calls[0].commentPoolTargetTermsLimit, 42);
  assert.equal(calls[0].priorityCommentPoolTargets, true);
  assert.equal(calls[0].preFilterCommentsToTargets, true);
  assert.equal(calls[0].deepenReplyThreads, true);
  assert.equal(calls[0].verbose, false);
  assert.equal(calls[0].prioritizeNearTarget, true);
  assert.equal(calls[0].existingTermsOnly, true);
  assert.equal(calls[0].discoveryLimit, 11);
  assert.equal(calls[0].discoveryPages, 3);
  assert.equal(calls[0].controversialPopularQueryLimit, 10);
  assert.equal(calls[0].controversialPopularSearchOrder, 'pubdate');
  assert.deepEqual(calls[0].priorityQueries, [{ term: 'doge', query: 'doge 评论区 热评' }]);
});
