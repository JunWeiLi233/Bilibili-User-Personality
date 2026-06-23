import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['worker', 'assignment', 'training', 'pacing', 'stats', 'userDb'];

export const DEFAULT_PAYLOAD = {
  argv: ['--worker=1', '--workers=3'],
  comments: {
    101: [{ message: 'worker zero', bvid: 'BV1' }],
    102: [{ message: 'worker one', bvid: 'BV2' }],
    103: [{ message: '', bvid: 'BV3' }],
    104: [{ message: 'worker zero again', bvid: 'BV4' }],
    105: [{ message: 'worker one pending', bvid: 'BV5' }],
  },
  progress: {
    processed: { 102: 'success' },
    stats: { success: 1, noText: 0, errors: 0 },
  },
  database: {
    users: {
      102: { uid: '102' },
      999: { uid: '999' },
    },
  },
};

export const UID_PARALLEL_PLAN_FIXTURES = {
  'default-worker': DEFAULT_PAYLOAD,
  'parseint-prefix': {
    argv: ['--worker=1abc', '--workers=3abc'],
    comments: {
      300: [{ message: 'worker zero' }],
      301: [{ message: 'worker one' }],
      302: [{ message: '' }],
      303: [{ message: 'worker zero again' }],
      304: [{ message: 'worker one pending' }],
    },
    progress: {
      processed: { 301: 'success' },
      stats: { success: '1ok', noText: '2bad', errors: '3err' },
    },
    database: {
      users: {
        301: {},
        304: {},
        999: {},
      },
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['default-worker', 'parseint-prefix'];

function resolvePayload({ fixture = 'default-worker', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default-worker');
  return { name, payload: UID_PARALLEL_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidParallelPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({
      key,
      python: python[key],
      js: js[key],
    }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/uidParallelAnalyzer.js', '--plan-json', `--payload=${payloadPath}`], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_parallel_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareUidParallelPlan({
  fixture = 'default-worker',
  fixtureNames,
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  if (fixtureNames) return compareUidParallelPlanSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-parallel-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareUidParallelPlanObjects(python, js);
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

export async function compareUidParallelPlanSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidParallelPlan({ fixture, runJs, runPython }));
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
  const result = await compareUidParallelPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
