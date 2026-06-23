import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

async function runJsProgress({ payload }) {
  const before = payload?.before && typeof payload.before === 'object' ? payload.before : {};
  const after = payload?.after && typeof payload.after === 'object' ? payload.after : {};
  const harvestProgress = Array.isArray(payload?.harvestProgress) ? payload.harvestProgress : [];
  const beforeActions = Array.isArray(payload?.beforeActions) ? payload.beforeActions : [];
  const afterActions = Array.isArray(payload?.afterActions) ? payload.afterActions : [];
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

export async function compareCoverageProgress({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsProgress,
  runPython = runPythonProgress,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-progress-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareCoverageProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareCoverageProgress();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
