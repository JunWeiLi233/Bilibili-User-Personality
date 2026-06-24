import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'progress', 'database', 'browser', 'pacing', 'sampleInvocation'];

export const DEFAULT_PAYLOAD = {
  argv: ['--start=100000', '--end=100005'],
  progress: {
    lastUid: 100002,
    completed: 2,
    errors: [{ uid: '100001', error: 'browser timeout' }],
  },
  database: {
    users: {
      99999: { uid: '99999' },
      100001: { uid: '100001' },
      100004: { uid: '100004' },
    },
  },
};

export const AICU_BROWSER_BATCH_PLAN_FIXTURES = {
  'default-range': DEFAULT_PAYLOAD,
  'fresh-range': {
    argv: ['--start=200000', '--end=200002'],
    progress: {},
    database: { users: { 200001: { uid: '200001' }, 199999: { uid: '199999' } } },
  },
  'completed-range': {
    argv: ['--start=300000', '--end=300002'],
    progress: { lastUid: 300002, completed: 3, errors: [] },
    database: { users: { 300000: { uid: '300000' }, 300001: { uid: '300001' }, 300002: { uid: '300002' } } },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(AICU_BROWSER_BATCH_PLAN_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareAicuBrowserBatchPlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/batchScrapeAicuBrowser.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.aicu_browser_batch_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.aicu_browser_batch_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
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
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-range';
  return { name, payload: AICU_BROWSER_BATCH_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareAicuBrowserBatchPlanSingle({
  payload,
  fixture,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'aicu-browser-plan-compare-'));
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

export async function compareAicuBrowserBatchPlan({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareAicuBrowserBatchPlanSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareAicuBrowserBatchPlanSingle({ payload: payload || DEFAULT_PAYLOAD, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareAicuBrowserBatchPlan({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
