import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['startedAt', 'workers', 'summary', 'stats'];
const STAT_KEYS = ['success', 'noComments', 'noVideos', 'noUser', 'trainError', 'blocked', 'errors'];

export const DEFAULT_PAYLOAD = {
  startedAt: '2026-06-19T00:00:00.000Z',
  launcher: {
    workers: [
      { start: 1, end: 2, progressFile: 'uid-pipeline-1-2.json' },
      { start: 3, end: 4, progressFile: 'uid-pipeline-3-4.json' },
    ],
  },
  progress: {
    'uid-pipeline-1-2.json': { processed: { 1: 'success', 2: 'blocked' }, stats: { success: 1, blocked: 1 } },
    'uid-pipeline-3-4.json': { processed: { 3: 'no_comments' }, stats: { noComments: 1 } },
  },
};

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidPipelineStateObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function readJson(path, fallback) {
  try {
    const payload = JSON.parse(await readFile(path, 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}

async function runJsState({ dataDir }) {
  const state = await readJson(join(dataDir, 'uid-pipeline-launcher.json'), {});
  const rawWorkers = Array.isArray(state.workers) ? state.workers : [];
  const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
  const workers = [];
  let totalProcessed = 0;
  let totalExpected = 0;
  let completedWorkers = 0;

  for (const rawWorker of rawWorkers) {
    if (!rawWorker || typeof rawWorker !== 'object' || Array.isArray(rawWorker)) continue;
    const start = intOrZero(rawWorker.start);
    const end = intOrZero(rawWorker.end);
    const total = Math.max(0, end - start + 1);
    const progressFile = String(rawWorker.progressFile || `uid-pipeline-${start}-${end}.json`);
    const progress = await readJson(join(dataDir, progressFile), {});
    const processed = progress.processed && typeof progress.processed === 'object' && !Array.isArray(progress.processed) ? progress.processed : {};
    const progressStats = progress.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
    const processedCount = Object.keys(processed).length;
    const complete = Boolean(total && processedCount >= total);

    totalProcessed += processedCount;
    totalExpected += total;
    completedWorkers += complete ? 1 : 0;
    for (const key of STAT_KEYS) stats[key] += intOrZero(progressStats[key]);
    workers.push({ start, end, progressFile, processed: processedCount, total, complete });
  }

  return {
    ok: true,
    startedAt: state.startedAt || null,
    workers,
    stats,
    summary: {
      workers: workers.length,
      completedWorkers,
      totalProcessed,
      totalExpected,
      completionRatio: totalExpected ? Math.round((totalProcessed / totalExpected) * 10000) / 10000 : 0,
    },
  };
}

async function runPythonState({ dataDir }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_pipeline_state', '--data-dir', dataDir], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(dataDir, payload) {
  await mkdir(dataDir, { recursive: true });
  const launcher = {
    ...(payload.launcher || {}),
    startedAt: payload.startedAt ?? payload.launcher?.startedAt,
  };
  await writeFile(join(dataDir, 'uid-pipeline-launcher.json'), JSON.stringify(launcher, null, 2), 'utf8');
  const progress = payload.progress && typeof payload.progress === 'object' && !Array.isArray(payload.progress) ? payload.progress : {};
  await Promise.all(
    Object.entries(progress).map(([file, filePayload]) => writeFile(join(dataDir, file), JSON.stringify(filePayload || {}, null, 2), 'utf8')),
  );
}

export async function compareUidPipelineState({ payload = DEFAULT_PAYLOAD, runJs = runJsState, runPython = runPythonState } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-pipeline-state-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'data');
    if (!payload.dataDir) await writeFixture(dataDir, payload);
    const context = { payload, dataDir };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareUidPipelineStateObjects(python, js);
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
  const result = await compareUidPipelineState();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
