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

export async function compareDeepSeekAnalyzePlan({
  argv = DEFAULT_ARGV,
  stdinIsTTY = true,
  runPythonPlan = runPythonCliPlan,
} = {}) {
  const js = buildPlan(parseArgs(argv), { stdinIsTTY });
  const python = await runPythonPlan({ argv, stdinIsTTY });
  const comparison = comparePlanObjects(python, js);

  return {
    ok: comparison.ok,
    fixture: { argv, stdinIsTTY },
    js,
    python,
    mismatches: comparison.mismatches,
  };
}

async function main() {
  const result = await compareDeepSeekAnalyzePlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
