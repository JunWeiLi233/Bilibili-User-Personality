import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  actionProgressDelta,
  coverageDelta,
  coverageDeltaFromHarvest,
  hasCoverageDeltaProgress,
  hasCoverageGateProgress,
} from '../utils/coverageProgress.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = [
  'delta',
  'harvestDelta',
  'actionDelta',
  'exhaustedTerms',
  'hasDeltaProgress',
  'hasHarvestProgress',
  'hasGateProgress',
];

export const DEFAULT_PAYLOAD = {
  before: { totalEvidence: 10, evidenceDeficit: 5, zeroEvidenceTerms: 2, weakTerms: 4 },
  after: { totalEvidence: 12, evidenceDeficit: 3, zeroEvidenceTerms: 1, weakTerms: 3 },
  harvestProgress: [{ weakTermsResolved: 0, zeroEvidenceResolved: 1, evidenceGained: 2, evidenceDeficitReduced: 2 }],
  beforeActions: [{ term: 'rare-term', needs: 2 }],
  afterActions: [{ term: 'rare-term', needs: 1 }],
};

export const COVERAGE_PROGRESS_FIXTURES = {
  'default-progress': DEFAULT_PAYLOAD,
  'action-progress': {
    before: { totalEvidence: 8, evidenceDeficit: 4, zeroEvidenceTerms: 2, weakTerms: 4 },
    after: { totalEvidence: 8, evidenceDeficit: 4, zeroEvidenceTerms: 2, weakTerms: 4 },
    harvestProgress: [],
    beforeActions: [
      { term: 'resolved-term', needs: 2 },
      { term: 'reduced-term', evidenceNeeded: 3 },
    ],
    afterActions: [{ term: 'reduced-term', evidenceNeeded: 1 }],
  },
  'corrupt-payload': {
    payloadRaw: '{not-json',
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(COVERAGE_PROGRESS_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareCoverageProgressObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function readJson(path, fallback) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function runJsProgress({ payload, payloadPath }) {
  const source = payload && !('payloadRaw' in payload) ? payload : await readJson(payloadPath, {});
  const before = source?.before && typeof source.before === 'object' ? source.before : {};
  const after = source?.after && typeof source.after === 'object' ? source.after : {};
  const harvestProgress = Array.isArray(source?.harvestProgress) ? source.harvestProgress : [];
  const beforeActions = Array.isArray(source?.beforeActions) ? source.beforeActions : [];
  const afterActions = Array.isArray(source?.afterActions) ? source.afterActions : [];
  const delta = coverageDelta(before, after);
  const harvestDelta = coverageDeltaFromHarvest(before, after, harvestProgress);
  return {
    ok: true,
    delta,
    harvestDelta,
    actionDelta: actionProgressDelta(beforeActions, afterActions),
    exhaustedTerms: [],
    hasDeltaProgress: hasCoverageDeltaProgress(delta),
    hasHarvestProgress: hasCoverageDeltaProgress(harvestDelta),
    hasGateProgress: hasCoverageGateProgress(before, after, { beforeActions, afterActions }),
  };
}

async function runPythonProgress({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.coverage_progress', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonProgressComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.coverage_progress', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-progress';
  return { name, payload: COVERAGE_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function writePayload(payloadPath, payload) {
  await writeFile(payloadPath, 'payloadRaw' in payload ? String(payload.payloadRaw ?? '') : JSON.stringify(payload || {}, null, 2), 'utf8');
}

async function compareCoverageProgressSingle({
  payload,
  fixture,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-progress-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writePayload(payloadPath, resolved.payload);
    const context = { payload: resolved.payload, fixture: { name: resolved.name }, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareCoverageProgress({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareCoverageProgressSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareCoverageProgressSingle({ payload: payload || DEFAULT_PAYLOAD, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareCoverageProgress({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
