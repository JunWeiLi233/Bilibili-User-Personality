import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['input', 'range', 'progress', 'database', 'limits', 'pacing', 'retry', 'collection', 'sampleRequests'];

export const DEFAULT_PAYLOAD = {
  argv: ['--pages=8'],
  progress: {
    pagesScanned: 3,
    videosScanned: 20,
    scraped: 4,
  },
  database: {
    users: {
      10: { uid: '10' },
      20: { uid: '20' },
    },
  },
};

export const BATCH_POPULAR_PLAN_FIXTURES = {
  'resume-progress': DEFAULT_PAYLOAD,
  'empty-progress': {
    argv: [],
    progress: {},
    database: {
      users: {},
    },
  },
  'parseint-prefix-progress': {
    argv: ['--pages=8.9 pages'],
    progress: {
      pagesScanned: '3.9 pages',
      videosScanned: '20 videos',
      scraped: '0x10',
    },
    database: {
      users: [{ uid: 'array-user' }],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['resume-progress', 'empty-progress', 'parseint-prefix-progress'];

function resolvePayload({ fixture = 'resume-progress', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'resume-progress');
  return { name, payload: BATCH_POPULAR_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBatchPopularPlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/batchScrapePopular.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.batch_popular_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareBatchPopularPlan({
  fixture = 'resume-progress',
  fixtureNames,
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  if (fixtureNames) return compareBatchPopularPlanSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-popular-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareBatchPopularPlanObjects(python, js);
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

export async function compareBatchPopularPlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareBatchPopularPlan({ fixture, runJs, runPython }));
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
  const result = await compareBatchPopularPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
