import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PLAN_KEYS = ['query', 'source', 'term', 'family'];
const RESULT_KEYS = ['queries', 'plan'];
const MISSED_FIRST_VARIANT = 'missed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4';

export const DEFAULT_PAYLOAD = {
  dictionary: {
    entries: [
      { term: 'fresh', family: 'attack', evidenceCount: 0 },
      { term: 'missed', family: 'attack', evidenceCount: 0 },
    ],
  },
  options: {
    seedQueries: [],
    coverageMode: 'all-weak',
    maxQueries: 2,
    queryVariantsPerTerm: 1,
    retryBeforeUnattemptedLimit: 3,
    termAttempts: {
      missed: {
        term: 'missed',
        attempts: 1,
        successfulAttempts: 0,
        queries: [{ query: MISSED_FIRST_VARIANT }],
      },
    },
  },
};

function summarize(result = {}) {
  const plan = Array.isArray(result.plan) ? result.plan : [];
  return {
    queries: Array.isArray(result.queries) ? result.queries : plan.map((item) => item?.query).filter(Boolean),
    plan: plan
      .filter((item) => item && typeof item === 'object')
      .map((item) => Object.fromEntries(PLAN_KEYS.map((key) => [key, item[key]]))),
  };
}

export function compareHarvestPlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/runVideoKeywordDiscovery.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.harvest_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareHarvestPlan({ payload = DEFAULT_PAYLOAD, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'harvest-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareHarvestPlanObjects(python, js);
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
  const result = await compareHarvestPlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
