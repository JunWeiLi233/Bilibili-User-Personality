import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['input', 'phase1', 'phase2', 'stats', 'pacing'];

export const DEFAULT_PAYLOAD = {
  argv: ['--start=200000', '--end=300000', '--pages=80', '--phase2-only'],
  progress: {
    scannedBvids: ['BV1', 'BV2'],
    _uidComments: {
      199999: [{ message: 'below', bvid: 'BV1' }],
      200000: [{ message: 'inside', bvid: 'BV1' }],
      250000: [{ message: 'inside2', bvid: 'BV2' }],
      300001: [{ message: 'above', bvid: 'BV2' }],
    },
    processedUids: { 200000: 'success', 250000: 'no_text' },
    stats: {
      videosScanned: 2,
      uidsFound: 4,
      targetUidsFound: 2,
      commentsCollected: 4,
      analyzed: 1,
      skipped: 1,
      errors: 0,
    },
  },
  database: {
    users: {
      200000: { uid: '200000' },
    },
  },
};

export const BATCH_UID_RANGE_PLAN_FIXTURES = {
  'phase2-progress': DEFAULT_PAYLOAD,
  'default-range': {
    argv: [],
    progress: {
      scannedBvids: [],
      _uidComments: {
        200000: [{ message: 'inside', bvid: 'BV1' }],
        300000: [{ message: 'inside upper', bvid: 'BV2' }],
        300001: [{ message: 'above', bvid: 'BV3' }],
      },
      processedUids: {},
      stats: {},
    },
    database: {
      users: {},
    },
  },
  'decimal-args-malformed-stats': {
    argv: ['--start=200000.5', '--end=300000.5', '--pages=80.5'],
    progress: {
      scannedBvids: ['BV decimal'],
      _uidComments: {
        200000: [{ message: 'below decimal start', bvid: 'BV decimal' }],
        200001: [{ message: 'inside decimal range', bvid: 'BV decimal' }],
        300001: [{ message: 'above integer upper but inside decimal range', bvid: 'BV decimal' }],
      },
      processedUids: {},
      stats: {
        videosScanned: 'broken',
        uidsFound: '0',
        targetUidsFound: 'NaN',
        commentsCollected: 'Infinity',
        analyzed: '',
        skipped: null,
        errors: '4',
      },
    },
    database: {
      users: [],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['phase2-progress', 'default-range', 'decimal-args-malformed-stats'];

function resolvePayload({ fixture = 'phase2-progress', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'phase2-progress');
  return { name, payload: BATCH_UID_RANGE_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBatchUidRangePlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/batchUidRange.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.batch_uid_range_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.batch_uid_range_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareBatchUidRangePlan({
  fixture = 'phase2-progress',
  fixtureNames,
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  if (fixtureNames) return compareBatchUidRangePlanSuite({ fixtures: fixtureNames, runJs, runPython, runCompare });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-uid-range-plan-compare-'));
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

export async function compareBatchUidRangePlanSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareBatchUidRangePlan({ fixture, runJs, runPython, runCompare }));
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
  const result = await compareBatchUidRangePlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
