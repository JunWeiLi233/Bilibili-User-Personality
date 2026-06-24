import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildPlan, parseArgs } from './analyzeDeepSeekComments.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_ARGV = ['--plan-json', '--text=satire [doge]', '--uid', '42', '--multiagent', 'extra sentence'];
const RESULT_KEYS = ['payload', 'input'];

export const DEEPSEEK_ANALYZE_PLAN_FIXTURES = {
  'argv-text-multiagent': {
    argv: DEFAULT_ARGV,
    stdinIsTTY: true,
    expected: {
      ok: true,
      payload: { text: 'satire [doge] extra sentence', uid: '42', multiagent: true },
      input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
    },
  },
  'stdin-pipe': {
    argv: ['--plan-json'],
    stdinIsTTY: false,
    expected: {
      ok: true,
      payload: {},
      input: { source: 'stdin', file: '', readsStdin: true, showHelp: false },
    },
  },
  'file-source': {
    argv: ['--plan-json', '--file', 'comments.txt', '--name=alice'],
    stdinIsTTY: true,
    expected: {
      ok: true,
      payload: { name: 'alice' },
      input: { source: 'file', file: 'comments.txt', readsStdin: false, showHelp: false },
    },
  },
  'payload-source': {
    argv: ['--plan-json', '--payload', 'analysis-payload.json'],
    stdinIsTTY: false,
    expected: {
      ok: true,
      payload: {},
      input: { source: 'payload', file: '', payloadPath: 'analysis-payload.json', readsStdin: false, showHelp: false },
    },
  },
  'help-source': {
    argv: ['--plan-json', '--help'],
    stdinIsTTY: true,
    expected: {
      ok: true,
      payload: {},
      input: { source: 'help', file: '', readsStdin: false, showHelp: true },
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(DEEPSEEK_ANALYZE_PLAN_FIXTURES);

function summarizePlan(plan = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in plan).map((key) => [key, plan[key]]));
}

export function comparePlanObjects(pythonPlan = {}, jsPlan = {}) {
  const mismatches = RESULT_KEYS.filter((key) => key in jsPlan && JSON.stringify(pythonPlan[key]) !== JSON.stringify(jsPlan[key])).map((key) => ({
    key,
    python: pythonPlan[key],
    js: jsPlan[key],
  }));

  return {
    ok: mismatches.length === 0,
    mismatches,
    python: summarizePlan(pythonPlan),
    js: summarizePlan(jsPlan),
  };
}

async function runPythonCliPlan({ argv, stdinIsTTY }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ argv, stdinIsTTY }, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      ['-m', 'python_backend.cli.deepseek_analyze_cli_plan', '--payload', payloadPath],
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runPythonCliPlanComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.deepseek_analyze_cli_plan', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

export async function compareDeepSeekAnalyzePlan({
  argv = DEFAULT_ARGV,
  stdinIsTTY = true,
  fixture,
  fixtureNames,
  runPythonPlan = runPythonCliPlan,
  runCompare = runPythonCliPlanComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareDeepSeekAnalyzePlan({ fixture: name, runPythonPlan, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? DEEPSEEK_ANALYZE_PLAN_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedArgv = resolvedFixture?.argv || argv;
  const resolvedStdinIsTTY = 'stdinIsTTY' in (resolvedFixture || {}) ? resolvedFixture.stdinIsTTY : stdinIsTTY;
  const js = buildPlan(parseArgs(resolvedArgv), { stdinIsTTY: resolvedStdinIsTTY });
  const python = await runPythonPlan({
    argv: resolvedArgv,
    stdinIsTTY: resolvedStdinIsTTY,
    fixture: { name: resolvedName, expected: resolvedFixture?.expected },
  });
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(payloadPath, JSON.stringify({ argv: resolvedArgv, stdinIsTTY: resolvedStdinIsTTY }, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({
      argv: resolvedArgv,
      stdinIsTTY: resolvedStdinIsTTY,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
      payloadPath,
      jsReportPath,
      js,
      python,
      jsPlan: js,
      pythonPlan: python,
    });

    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, argv: resolvedArgv, stdinIsTTY: resolvedStdinIsTTY, payloadPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDeepSeekAnalyzePlan({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
