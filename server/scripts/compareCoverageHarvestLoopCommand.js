import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

export async function compareCoverageHarvestLoopCommand({
  dictionary = DEFAULT_DICTIONARY,
  runJs = runJsCoverageLoopCommand,
  runPython = runPythonCoverageLoopCommand,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-loop-command-compare-'));
  try {
    const jsDictionaryPath = join(tempDir, 'dictionary-js.json');
    const pythonDictionaryPath = join(tempDir, 'dictionary-python.json');
    const jsStatePath = join(tempDir, 'state-js.json');
    const pythonStatePath = join(tempDir, 'state-python.json');
    const jsReportPath = join(tempDir, 'report-js.json');
    const pythonReportPath = join(tempDir, 'report-python.json');
    await writeFile(jsDictionaryPath, JSON.stringify(dictionary, null, 2), 'utf8');
    await writeFile(pythonDictionaryPath, JSON.stringify(dictionary, null, 2), 'utf8');
    const js = await runJs({ dictionaryPath: jsDictionaryPath, statePath: jsStatePath, reportPath: jsReportPath });
    const python = await runPython({ dictionaryPath: pythonDictionaryPath, statePath: pythonStatePath, reportPath: pythonReportPath });
    const comparison = compareCoverageHarvestLoopCommandObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { tempDir },
      js,
      python,
      mismatches: comparison.mismatches,
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
