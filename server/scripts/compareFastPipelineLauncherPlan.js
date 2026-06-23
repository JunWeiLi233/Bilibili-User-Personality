import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['workers', 'summary'];
const RANGES = [
  [1, 20000],
  [20001, 40000],
  [40001, 60000],
  [60001, 80000],
  [80001, 100000],
];

export const DEFAULT_PAYLOAD = {};

function summarize(result = {}) {
  const summary = {};
  if ('workers' in result) {
    summary.workers = Array.isArray(result.workers)
      ? result.workers
        .filter((worker) => worker && typeof worker === 'object')
        .map((worker) => ({
          start: worker.start,
          end: worker.end,
          progressFile: worker.progressFile,
        }))
      : [];
  }
  if ('summary' in result) summary.summary = result.summary;
  return summary;
}

export function compareFastPipelineLauncherPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function buildJsCompatiblePlan(dataDir, script = 'server/scripts/uidPipelineFast.js', launchDelaySeconds = 5) {
  const workers = RANGES.map(([start, end]) => {
    const progressFile = `uid-pipeline-fast-${start}-${end}.json`;
    const logName = `uid-pipeline-fast-${start}-${end}.log`;
    return {
      start,
      end,
      progressFile,
      logFile: `scraper-logs/${logName}`,
      stderrFile: `scraper-logs/${logName.replace('.log', '-stderr.log')}`,
      cmdArgs: `/c node "${script}" --start=${start} --end=${end}`,
      args: [`--start=${start}`, `--end=${end}`],
    };
  });
  return {
    ok: true,
    script,
    shell: 'cmd',
    logDir: join(dataDir, 'scraper-logs'),
    workers,
    summary: {
      workers: workers.length,
      totalStart: workers[0]?.start || 0,
      totalEnd: workers.at(-1)?.end || 0,
      totalUids: workers.reduce((total, worker) => total + worker.end - worker.start + 1, 0),
      launchDelaySeconds,
    },
  };
}

async function runJsPlan({ dataDir }) {
  return buildJsCompatiblePlan(dataDir);
}

async function runPythonPlan({ dataDir }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.fast_pipeline_launcher', '--data-dir', dataDir], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareFastPipelineLauncherPlan({ payload = DEFAULT_PAYLOAD, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'fast-pipeline-launcher-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'server', 'data');
    const js = await runJs({ payload, dataDir });
    const python = await runPython({ payload, dataDir });
    const comparison = compareFastPipelineLauncherPlanObjects(python, js);
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
  const result = await compareFastPipelineLauncherPlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
