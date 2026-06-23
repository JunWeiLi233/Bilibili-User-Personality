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

export async function compareUidRangeScrapePlan({ payload = DEFAULT_PAYLOAD, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-range-scrape-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareUidRangeScrapePlanObjects(python, js);
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
  const result = await compareUidRangeScrapePlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
