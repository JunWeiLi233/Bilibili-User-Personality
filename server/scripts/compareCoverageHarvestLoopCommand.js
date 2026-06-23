import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { coverageDeltaFromHarvest } from '../utils/coverageProgress.js';

const execFileAsync = promisify(execFile);

const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const SUMMARY_KEYS = [
  'maxCycles',
  'roundsPerCycle',
  'stopReason',
  'finalOk',
  'cyclesLength',
  'coverageTerms',
  'weakTerms',
  'zeroEvidenceTerms',
  'recommendedQueries',
];

export const DEFAULT_DICTIONARY = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [],
};

export const WEAK_DICTIONARY = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    {
      term: '百分百',
      family: 'absolutes',
      meaning: '缺少限定条件的强断言',
      risk: 'medium',
      confidence: 0.85,
      evidenceCount: 0,
      evidenceSamples: [],
      evidenceSources: [],
    },
  ],
};

export const MOCK_CYCLE_PAYLOAD = {
  generatedAt: GENERATED_AT,
  maxCycles: 1,
  roundsPerCycle: 1,
  cycle: 1,
  stopReason: 'coverage_gate_passed',
  priorityQueries: [{ query: 'doge hot', term: 'doge' }],
  beforeAudit: {
    ok: false,
    coverage: {
      terms: 1,
      weakTerms: 1,
      zeroEvidenceTerms: 1,
      unsourcedEvidenceTerms: 1,
      totalEvidence: 0,
      evidenceDeficit: 3,
      coverageRatio: 0,
    },
  },
  afterAudit: {
    ok: true,
    coverage: {
      terms: 1,
      weakTerms: 0,
      zeroEvidenceTerms: 0,
      unsourcedEvidenceTerms: 0,
      totalEvidence: 3,
      evidenceDeficit: 0,
      coverageRatio: 1,
    },
  },
  harvest: {
    ok: true,
    rounds: [
      {
        queries: ['doge hot', 'doge comments'],
        warnings: ['slow query'],
        coverageProgress: { evidenceGained: 3, zeroEvidenceResolved: 1 },
        trainingDiagnostics: { accepted: 2 },
        queryDiagnostics: [{ query: 'doge hot', videos: 1 }],
      },
    ],
  },
};

export const MOCK_NO_PROGRESS_CYCLE_PAYLOAD = {
  generatedAt: GENERATED_AT,
  maxCycles: 1,
  roundsPerCycle: 1,
  cycle: 1,
  stopReason: 'no_coverage_progress',
  priorityQueries: [{ query: 'doge retry', term: 'doge' }],
  beforeAudit: {
    ok: false,
    coverage: {
      terms: 1,
      weakTerms: 1,
      zeroEvidenceTerms: 0,
      unsourcedEvidenceTerms: 0,
      totalEvidence: 1,
      evidenceDeficit: 2,
      coverageRatio: 0.3333,
    },
  },
  afterAudit: {
    ok: false,
    coverage: {
      terms: 1,
      weakTerms: 1,
      zeroEvidenceTerms: 0,
      unsourcedEvidenceTerms: 0,
      totalEvidence: 1,
      evidenceDeficit: 2,
      coverageRatio: 0.3333,
    },
  },
  harvest: {
    ok: true,
    rounds: [
      {
        queries: ['doge retry'],
        warnings: ['no fresh evidence'],
        coverageProgress: { evidenceGained: 0, zeroEvidenceResolved: 0, weakTermsResolved: 0 },
        trainingDiagnostics: { accepted: 0 },
        queryDiagnostics: [{ query: 'doge retry', videos: 0 }],
      },
    ],
  },
};

export const MOCK_MULTI_CYCLE_PAYLOAD = {
  generatedAt: GENERATED_AT,
  maxCycles: 2,
  roundsPerCycle: 1,
  stopReason: 'coverage_gate_passed',
  cycles: [
    {
      cycle: 1,
      priorityQueries: [{ query: 'doge hot', term: 'doge' }],
      beforeAudit: {
        ok: false,
        coverage: {
          terms: 1,
          weakTerms: 1,
          zeroEvidenceTerms: 1,
          unsourcedEvidenceTerms: 1,
          totalEvidence: 0,
          evidenceDeficit: 3,
          coverageRatio: 0,
        },
      },
      afterAudit: {
        ok: false,
        coverage: {
          terms: 1,
          weakTerms: 1,
          zeroEvidenceTerms: 0,
          unsourcedEvidenceTerms: 0,
          totalEvidence: 1,
          evidenceDeficit: 2,
          coverageRatio: 0.3333,
        },
      },
      harvest: {
        ok: true,
        rounds: [
          {
            queries: ['doge hot'],
            warnings: [],
            coverageProgress: { evidenceGained: 1, zeroEvidenceResolved: 1 },
            trainingDiagnostics: { accepted: 1 },
            queryDiagnostics: [{ query: 'doge hot', videos: 1 }],
          },
        ],
      },
    },
    {
      cycle: 2,
      priorityQueries: [{ query: 'doge source', term: 'doge' }],
      beforeAudit: {
        ok: false,
        coverage: {
          terms: 1,
          weakTerms: 1,
          zeroEvidenceTerms: 0,
          unsourcedEvidenceTerms: 0,
          totalEvidence: 1,
          evidenceDeficit: 2,
          coverageRatio: 0.3333,
        },
      },
      afterAudit: {
        ok: true,
        coverage: {
          terms: 1,
          weakTerms: 0,
          zeroEvidenceTerms: 0,
          unsourcedEvidenceTerms: 0,
          totalEvidence: 3,
          evidenceDeficit: 0,
          coverageRatio: 1,
        },
      },
      harvest: {
        ok: true,
        rounds: [
          {
            queries: ['doge source'],
            warnings: ['retry source'],
            coverageProgress: { evidenceGained: 2, weakTermsResolved: 1 },
            trainingDiagnostics: { accepted: 2 },
            queryDiagnostics: [{ query: 'doge source', videos: 2 }],
          },
        ],
      },
    },
  ],
};

const DEFAULT_FIXTURES = [
  { name: 'complete-empty-dictionary', dictionary: DEFAULT_DICTIONARY },
  { name: 'weak-cycle-limit', dictionary: WEAK_DICTIONARY },
  { name: 'mock-cycle-report', mockCyclePayload: MOCK_CYCLE_PAYLOAD },
  { name: 'mock-no-progress-cycle', mockCyclePayload: MOCK_NO_PROGRESS_CYCLE_PAYLOAD },
  { name: 'mock-multi-cycle-report', mockCyclePayload: MOCK_MULTI_CYCLE_PAYLOAD },
];

function summarize(report = {}) {
  const coverage = report.finalAudit?.coverage || {};
  return {
    maxCycles: Number(report.maxCycles || 0),
    roundsPerCycle: Number(report.roundsPerCycle || 0),
    stopReason: report.stopReason || '',
    finalOk: report.finalOk === true,
    cyclesLength: Array.isArray(report.cycles) ? report.cycles.length : 0,
    coverageTerms: Number(coverage.terms || 0),
    weakTerms: Number(coverage.weakTerms || 0),
    zeroEvidenceTerms: Number(coverage.zeroEvidenceTerms || 0),
    recommendedQueries: Array.isArray(report.finalAudit?.recommendedQueries) ? report.finalAudit.recommendedQueries : [],
  };
}

export function compareCoverageHarvestLoopCommandObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsCoverageLoopCommand({ dictionaryPath, statePath, reportPath }) {
  await execFileAsync('node', ['server/scripts/runCoverageHarvestLoop.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
      BILIBILI_HARVEST_STATE_PATH: statePath,
      BILIBILI_COVERAGE_LOOP_REPORT_PATH: reportPath,
      BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(await readFile(reportPath, 'utf8'));
}

async function runPythonCoverageLoopCommand({ dictionaryPath, statePath, reportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.coverage_loop_command',
      '--dictionary',
      dictionaryPath,
      '--state',
      statePath,
      '--report',
      reportPath,
      '--max-cycles',
      '0',
      '--generated-at',
      GENERATED_AT,
      '--exit-zero',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function buildJsMockCycleReport(payload = {}) {
  if (Array.isArray(payload.cycles)) {
    const cycles = payload.cycles.map((cyclePayload, index) => buildJsMockCycle(cyclePayload, index + 1));
    const finalAudit = payload.cycles.length ? payload.cycles[payload.cycles.length - 1]?.afterAudit || {} : {};
    return {
      generatedAt: payload.generatedAt || GENERATED_AT,
      maxCycles: Number(payload.maxCycles || 1),
      roundsPerCycle: Number(payload.roundsPerCycle || 1),
      stopReason: payload.stopReason || (finalAudit.ok === true ? 'coverage_gate_passed' : ''),
      finalOk: finalAudit.ok === true,
      finalAudit,
      cycles,
    };
  }
  const afterAudit = payload.afterAudit && typeof payload.afterAudit === 'object' ? payload.afterAudit : {};
  return {
    generatedAt: payload.generatedAt || GENERATED_AT,
    maxCycles: Number(payload.maxCycles || 1),
    roundsPerCycle: Number(payload.roundsPerCycle || 1),
    stopReason: payload.stopReason || (afterAudit.ok === true ? 'coverage_gate_passed' : ''),
    finalOk: afterAudit.ok === true,
    finalAudit: afterAudit,
    cycles: [buildJsMockCycle(payload, 1)],
  };
}

function buildJsMockCycle(payload = {}, fallbackCycle = 1) {
  const beforeAudit = payload.beforeAudit && typeof payload.beforeAudit === 'object' ? payload.beforeAudit : {};
  const afterAudit = payload.afterAudit && typeof payload.afterAudit === 'object' ? payload.afterAudit : {};
  const beforeCoverage = beforeAudit.coverage && typeof beforeAudit.coverage === 'object' ? beforeAudit.coverage : {};
  const afterCoverage = afterAudit.coverage && typeof afterAudit.coverage === 'object' ? afterAudit.coverage : {};
  const rounds = Array.isArray(payload.harvest?.rounds) ? payload.harvest.rounds : [];
  const harvest = {
    ok: payload.harvest?.ok === true,
    rounds: rounds.length,
    queries: rounds.flatMap((round) => Array.isArray(round?.queries) ? round.queries : []),
    warnings: rounds.flatMap((round) => Array.isArray(round?.warnings) ? round.warnings : []),
    coverageProgress: rounds.map((round) => round?.coverageProgress),
    trainingDiagnostics: rounds.map((round) => round?.trainingDiagnostics),
    queryDiagnostics: rounds.map((round) => Array.isArray(round?.queryDiagnostics) ? round.queryDiagnostics : []),
  };
  return {
    cycle: Number(payload.cycle || fallbackCycle),
    priorityQueries: Array.isArray(payload.priorityQueries) ? payload.priorityQueries : [],
    harvest,
    coverageDelta: coverageDeltaFromHarvest(beforeCoverage, afterCoverage, harvest.coverageProgress),
    coverageBefore: beforeCoverage,
    coverageAfter: afterCoverage,
  };
}

async function runPythonMockCycleReport({ payload, payloadPath }) {
  await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
  const reportPath = payloadPath.replace(/-payload\.json$/, '-report-python.json');
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.coverage_loop_command', '--mock-cycle-payload', payloadPath, '--report', reportPath, '--exit-zero'],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return { stdoutReport: JSON.parse(stdout), fileReport: JSON.parse(await readFile(reportPath, 'utf8')) };
}

export async function compareCoverageHarvestLoopCommand({
  dictionary = DEFAULT_DICTIONARY,
  fixtures = null,
  runJs = runJsCoverageLoopCommand,
  runPython = runPythonCoverageLoopCommand,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-loop-command-compare-'));
  try {
    const fixtureList = Array.isArray(fixtures) ? fixtures : dictionary === DEFAULT_DICTIONARY ? DEFAULT_FIXTURES : [{ name: 'custom', dictionary }];
    const results = [];
    for (const [index, fixture] of fixtureList.entries()) {
      const fixtureName = String(fixture?.name || `fixture-${index + 1}`);
      const fixtureDictionary = fixture?.dictionary || DEFAULT_DICTIONARY;
      const jsDictionaryPath = join(tempDir, `${fixtureName}-dictionary-js.json`);
      const pythonDictionaryPath = join(tempDir, `${fixtureName}-dictionary-python.json`);
      const jsStatePath = join(tempDir, `${fixtureName}-state-js.json`);
      const pythonStatePath = join(tempDir, `${fixtureName}-state-python.json`);
      const jsReportPath = join(tempDir, `${fixtureName}-report-js.json`);
      const pythonReportPath = join(tempDir, `${fixtureName}-report-python.json`);
      if (fixture?.mockCyclePayload) {
        const payloadPath = join(tempDir, `${fixtureName}-payload.json`);
        const js = buildJsMockCycleReport(fixture.mockCyclePayload);
        const pythonRun = await runPythonMockCycleReport({ payload: fixture.mockCyclePayload, payloadPath });
        const python = pythonRun.stdoutReport;
        const comparison = compareCoverageHarvestLoopCommandObjects(python, js);
        results.push({
          ok: comparison.ok,
          fixture: fixtureName,
          js,
          python,
          pythonReportFile: pythonRun.fileReport,
          mismatches: comparison.mismatches,
        });
        continue;
      }
      await writeFile(jsDictionaryPath, JSON.stringify(fixtureDictionary, null, 2), 'utf8');
      await writeFile(pythonDictionaryPath, JSON.stringify(fixtureDictionary, null, 2), 'utf8');
      const js = await runJs({ dictionaryPath: jsDictionaryPath, statePath: jsStatePath, reportPath: jsReportPath });
      const python = await runPython({ dictionaryPath: pythonDictionaryPath, statePath: pythonStatePath, reportPath: pythonReportPath });
      const comparison = compareCoverageHarvestLoopCommandObjects(python, js);
      results.push({
        ok: comparison.ok,
        fixture: fixtureName,
        js,
        python,
        mismatches: comparison.mismatches,
      });
    }
    const first = results[0] || {};
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ fixture: result.fixture, ...mismatch })));
    return {
      ok: results.every((result) => result.ok),
      fixture: { tempDir },
      js: first.js,
      python: first.python,
      results,
      mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareCoverageHarvestLoopCommand();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
