import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['uids', 'summary', 'requests'];

export const DEFAULT_PAYLOAD = {
  argv: [
    '--uid=123456',
    'https://space.bilibili.com/789012',
    '--uid=123456',
  ],
};

export const AICU_SCRAPE_PLAN_FIXTURES = {
  'inline-dedupe': DEFAULT_PAYLOAD,
  'missing-file': {
    argv: ['--file=server/data/does-not-exist-aicu-uids.txt'],
  },
  'page-overrides': {
    argv: ['--uid=100', 'https://space.bilibili.com/101'],
    maxPages: 4,
    pageSize: 8,
    delayBetweenUidsMs: 2500,
  },
};

const DEFAULT_FIXTURE_NAMES = ['inline-dedupe', 'missing-file', 'page-overrides'];

function resolvePayload({ fixture = 'inline-dedupe', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'inline-dedupe');
  return { name, payload: AICU_SCRAPE_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareAicuScrapePlanObjects(pythonResult = {}, jsResult = {}) {
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
  const { stdout } = await execFileAsync('node', ['server/scripts/scrapeAicuUsers.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.aicu_scrape_plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error?.stdout || '';
    if (!stdout) throw error;
  }
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.aicu_scrape_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareAicuScrapePlan({
  fixture = 'inline-dedupe',
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'aicu-scrape-plan-compare-'));
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

export async function compareAicuScrapePlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareAicuScrapePlan({ fixture }));
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
  const result = await compareAicuScrapePlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
