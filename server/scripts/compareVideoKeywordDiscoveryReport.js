import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  priorityActionItemsFromHarvestResult,
  serializeVideoKeywordDiscoveryReport,
} from '../utils/runVideoKeywordDiscoveryReport.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'report', 'priorityActionItems', 'trainingDiagnostics', 'queryDiagnostics', 'roundSummary'];

export const DEFAULT_PAYLOAD = {
  generatedAt: '2026-06-23T00:00:00.000Z',
  statePath: 'server/data/coverageHarvestState.json',
  reportPath: 'server/data/videoKeywordDiscoveryReport.json',
  result: {
    requestedRounds: 1,
    growth: { before: 1, after: 2 },
    coverage: null,
    coverageActions: [{ term: 'doge', action: 'retry', nextQuery: 'doge hot' }],
    state: null,
    rounds: [
      {
        queries: ['doge hot'],
        candidateQueries: null,
        growth: null,
        coverage: null,
        coverageProgress: null,
        termAttemptSummary: null,
        trainingDiagnostics: null,
        queryDiagnostics: null,
        warnings: null,
        results: [],
      },
    ],
  },
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareVideoKeywordDiscoveryReportObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsReport({ payload }) {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
  const report = serializeVideoKeywordDiscoveryReport(result, payload?.statePath || '', payload?.reportPath || '');
  if (payload?.generatedAt) report.generatedAt = payload.generatedAt;
  return {
    ok: true,
    mode: 'report',
    report,
    priorityActionItems: priorityActionItemsFromHarvestResult(result),
  };
}

async function runPythonReport({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.discovery_report', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareVideoKeywordDiscoveryReport({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsReport,
  runPython = runPythonReport,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'discovery-report-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareVideoKeywordDiscoveryReportObjects(python, js);
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
  const result = await compareVideoKeywordDiscoveryReport();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
