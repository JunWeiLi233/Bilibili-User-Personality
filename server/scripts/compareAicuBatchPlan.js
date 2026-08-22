import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'progress', 'database', 'limits', 'pacing', 'retry', 'sampleRequests'];

export const DEFAULT_PAYLOAD = {
  argv: ['--start=100000', '--end=100005'],
  progress: {
    lastUid: 100002,
    completed: 2,
    errors: [{ uid: '100001', error: 'HTTP 429' }],
  },
  database: {
    users: {
      99999: { uid: '99999' },
      100001: { uid: '100001' },
      100004: { uid: '100004' },
    },
  },
};

export const AICU_BATCH_PLAN_FIXTURES = {
  'resume-with-existing-users': DEFAULT_PAYLOAD,
  'empty-effective-range': {
    argv: ['--start=100000', '--end=100005'],
    progress: {
      lastUid: 100010,
      completed: 7,
      errors: [],
    },
    database: {
      users: {
        100003: { uid: '100003' },
        100006: { uid: '100006' },
      },
    },
  },
  'malformed-payload': {
    argv: ['--start=not-a-number', '--end=not-a-number'],
    progress: {
      lastUid: 'not-a-number',
      completed: 'not-a-number',
      errors: { not: 'a-list' },
    },
    database: {
      users: ['not', 'an', 'object'],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['resume-with-existing-users', 'empty-effective-range', 'malformed-payload'];

function resolvePayload({ fixture = 'resume-with-existing-users', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'resume-with-existing-users');
  return { name, payload: AICU_BATCH_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareAicuBatchPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/batchScrapeAicu.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.aicu_batch_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.aicu_batch_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareAicuBatchPlan({
  fixture = 'resume-with-existing-users',
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'aicu-batch-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
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

export async function compareAicuBatchPlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareAicuBatchPlan({ fixture }));
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
  const result = await compareAicuBatchPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
