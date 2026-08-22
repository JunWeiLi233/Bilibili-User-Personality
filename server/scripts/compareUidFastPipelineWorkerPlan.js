import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildUidFastPipelineWorkerPlan } from './uidPipelineFastWorker.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'progress', 'limits', 'network', 'pacing', 'training', 'blockPolicy', 'stats', 'userDb'];

export const DEFAULT_PAYLOAD = {
  argv: ['--start=2', '--end=4', '--concurrency=7'],
  progress: {
    processed: { 2: 'success', 3: 'no_user' },
    stats: { success: 1, noUser: 1 },
  },
  database: { users: { 2: {}, 99: {} } },
};

export const UID_FAST_WORKER_PLAN_FIXTURES = {
  'default-worker': DEFAULT_PAYLOAD,
  'number-fallback-and-parseint-uids': {
    argv: ['--start=12abc', '--end=14abc', '--concurrency=7abc'],
    progress: {
      processed: { 12: 'success', 13: 'blocked' },
      stats: { success: '1ok', blocked: '1blocked', errors: '2bad' },
    },
    database: {
      users: {
        '12abc': {},
        13: {},
        99: {},
      },
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['default-worker', 'number-fallback-and-parseint-uids'];

function resolvePayload({ fixture = 'default-worker', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default-worker');
  return { name, payload: UID_FAST_WORKER_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidFastPipelineWorkerPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/uidPipelineFastWorker.js', '--plan-json', '--js-plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_fast_pipeline_worker_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareUidFastPipelineWorkerPlan({
  fixture = 'default-worker',
  fixtureNames,
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  if (fixtureNames) return compareUidFastPipelineWorkerPlanSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-fast-worker-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareUidFastPipelineWorkerPlanObjects(python, js);
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

export async function compareUidFastPipelineWorkerPlanSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidFastPipelineWorkerPlan({ fixture, runJs, runPython }));
  }
  return {
    ok: results.every((result) => result.ok),
    fixtures: results.map((result) => ({
      name: result.fixture.name,
      ok: result.ok,
      js: result.js,
      python: result.python,
      mismatches: result.mismatches,
    })),
  };
}

async function main() {
  const result = await compareUidFastPipelineWorkerPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
