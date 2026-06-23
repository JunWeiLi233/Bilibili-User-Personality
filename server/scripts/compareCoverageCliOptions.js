import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildCoverageRuntimeOptions } from '../utils/coverageCliOptions.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['mode', 'options'];

export const DEFAULT_PAYLOAD = {
  mode: 'coverage-runtime',
  env: {
    BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
    BILIBILI_HARVEST_TARGET_EVIDENCE: '3',
  },
  argv: ['--target-evidence', '2', '--max-actions=7', '--retry-before-unattempted', '4'],
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareCoverageCliOptionsObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsOptions({ payload }) {
  return {
    ok: true,
    mode: 'coverage-runtime',
    options: buildCoverageRuntimeOptions({
      argv: Array.isArray(payload?.argv) ? payload.argv : [],
      env: payload?.env && typeof payload.env === 'object' ? payload.env : {},
      maxActionsFallback: Number(payload?.maxActionsFallback) || 20,
    }),
  };
}

async function runPythonOptions({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.harvest_options', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareCoverageCliOptions({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsOptions,
  runPython = runPythonOptions,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-cli-options-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const normalizedPayload = { mode: 'coverage-runtime', ...payload };
    await writeFile(payloadPath, JSON.stringify(normalizedPayload, null, 2), 'utf8');
    const js = await runJs({ payload: normalizedPayload, payloadPath });
    const python = await runPython({ payload: normalizedPayload, payloadPath });
    const comparison = compareCoverageCliOptionsObjects(python, js);
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
  const result = await compareCoverageCliOptions();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
