import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['workers'];

export const DEFAULT_PAYLOAD = {};

function summarize(result = {}) {
  const rawState = result.state && typeof result.state === 'object' ? result.state : result;
  const workers = Array.isArray(rawState.workers) ? rawState.workers : [];
  return {
    workers: workers
      .filter((worker) => worker && typeof worker === 'object')
      .map((worker) => ({
        start: worker.start,
        end: worker.end,
        progressFile: worker.progressFile,
      })),
  };
}

export function compareUidPipelineLauncherPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({
      key,
      python: python[key],
      js: js[key],
    }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ dataDir }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/launchUidPipeline.js', '--plan-json', '--data-dir', dataDir], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ dataDir }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_pipeline_launcher', '--data-dir', dataDir], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareUidPipelineLauncherPlan({ payload = DEFAULT_PAYLOAD, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-pipeline-launcher-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'server', 'data');
    const js = await runJs({ payload, dataDir });
    const python = await runPython({ payload, dataDir });
    const comparison = compareUidPipelineLauncherPlanObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { dataDir },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareUidPipelineLauncherPlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
