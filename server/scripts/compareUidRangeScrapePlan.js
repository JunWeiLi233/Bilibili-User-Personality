import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildUidRangeScrapePlan } from './uidRangeScrape.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'resume', 'collection', 'stats', 'pacing', 'training'];

export const DEFAULT_PAYLOAD = {
  argv: ['--start=10', '--end=12', '--progress=custom-progress.json'],
  progress: {
    processed: { 10: 'success', 11: 'no_comments' },
    stats: { success: 1, noComments: 1, noVideos: 0, errors: 0, blocked: 0 },
  },
  database: { users: { 10: { uid: '10' } } },
};

export const UID_RANGE_SCRAPE_PLAN_FIXTURES = {
  'custom-progress-resume': DEFAULT_PAYLOAD,
  'default-range-empty': {
    argv: [],
    progress: {
      processed: {},
      stats: {},
    },
    database: {
      users: {},
    },
  },
  'malformed-progress-stats': {
    argv: ['--start=not-a-number', '--end=0'],
    progress: {
      processed: { 1: 'success' },
      stats: {
        success: '12 ok',
        noComments: '2.9x',
        noVideos: 'not-a-number',
        errors: '4 errors',
        blocked: '5x',
      },
    },
    database: {
      users: {},
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['custom-progress-resume', 'default-range-empty', 'malformed-progress-stats'];

function resolvePayload({ fixture = 'custom-progress-resume', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'custom-progress-resume');
  return { name, payload: UID_RANGE_SCRAPE_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidRangeScrapePlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/uidRangeScrape.js', '--plan-json', '--js-plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_range_scrape_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareUidRangeScrapePlan({
  fixture = 'custom-progress-resume',
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-range-scrape-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareUidRangeScrapePlanObjects(python, js);
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

export async function compareUidRangeScrapePlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidRangeScrapePlan({ fixture }));
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
  const result = await compareUidRangeScrapePlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
