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

export const COVERAGE_CLI_OPTIONS_FIXTURES = {
  'default-runtime-options': DEFAULT_PAYLOAD,
  'env-fallbacks': {
    mode: 'coverage-runtime',
    env: {
      BILIBILI_HARVEST_TARGET_EVIDENCE: '5',
      BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS: '8',
      BILIBILI_COVERAGE_AUDIT_RETRY_BEFORE_UNATTEMPTED: '2',
    },
    argv: [],
  },
  'strict-source-backed': {
    mode: 'coverage-runtime',
    env: {},
    argv: ['--strict-source-backed', '--strict-comment-backed', '--target-evidence=4', '--max-actions', '6'],
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(COVERAGE_CLI_OPTIONS_FIXTURES);

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

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-runtime-options';
  return { name, payload: COVERAGE_CLI_OPTIONS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareCoverageCliOptionsSingle({ payload, fixture, runJs = runJsOptions, runPython = runPythonOptions } = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'coverage-cli-options-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const normalizedPayload = { mode: 'coverage-runtime', ...resolved.payload };
    await writeFile(payloadPath, JSON.stringify(normalizedPayload, null, 2), 'utf8');
    const context = { payload: normalizedPayload, fixture: { name: resolved.name }, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareCoverageCliOptionsObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareCoverageCliOptions({ payload, fixture, fixtureNames, runJs = runJsOptions, runPython = runPythonOptions } = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareCoverageCliOptionsSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareCoverageCliOptionsSingle({ payload: payload || DEFAULT_PAYLOAD, fixture, runJs, runPython });
}

async function main() {
  const result = await compareCoverageCliOptions({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
