import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['discovery', 'phase2', 'stats', 'training', 'pacing'];

export const DEFAULT_PAYLOAD = {
  progress: {
    scannedBvids: ['BV1', 'BV2'],
    _uidComments: {
      100: [{ message: 'one', bvid: 'BV1' }, { message: 'two', bvid: 'BV2' }],
      101: [{ message: '', bvid: 'BV2' }],
      102: [{ message: 'three', bvid: 'BV2' }],
    },
    processedUids: { 100: 'success' },
    stats: { videosScanned: 2, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 0 },
  },
  database: {
    users: {
      100: { uid: '100' },
      999: { uid: '999' },
    },
  },
};

export const BATCH_UID_SCRAPE_PLAN_FIXTURES = {
  'populated-progress': DEFAULT_PAYLOAD,
  'empty-progress': {
    progress: {
      scannedBvids: [],
      _uidComments: {},
      processedUids: {},
      stats: {},
    },
    database: {
      users: {},
    },
  },
  'malformed-stats': {
    progress: {
      scannedBvids: ['BV malformed'],
      _uidComments: {
        42: [{ message: 'hit', bvid: 'BV malformed' }],
      },
      processedUids: {},
      stats: {
        videosScanned: '12 videos',
        uidsFound: '3.9x',
        uidsAnalyzed: 'not-a-number',
        commentsCollected: '4 comments',
        errors: '5x',
      },
    },
    database: {
      users: {},
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['populated-progress', 'empty-progress', 'malformed-stats'];

function resolvePayload({ fixture = 'populated-progress', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'populated-progress');
  return { name, payload: BATCH_UID_SCRAPE_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBatchUidScrapePlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/batchUidScrape.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.batch_uid_scrape_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.batch_uid_scrape_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareBatchUidScrapePlan({
  fixture = 'populated-progress',
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-uid-scrape-plan-compare-'));
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

export async function compareBatchUidScrapePlanSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareBatchUidScrapePlan({ fixture, runJs, runPython, runCompare }));
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
  const result = await compareBatchUidScrapePlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
