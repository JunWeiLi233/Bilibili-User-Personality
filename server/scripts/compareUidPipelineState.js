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

export const UID_PIPELINE_STATE_FIXTURES = {
  'default-state': DEFAULT_PAYLOAD,
  'parseint-worker-prefix': {
    startedAt: '2026-06-20T00:00:00.000Z',
    launcher: {
      workers: [{ start: '7abc', end: '8abc' }],
    },
    progress: {
      'uid-pipeline-7-8.json': { processed: { 7: 'success' }, stats: { success: '1ok', blocked: '2bad' } },
    },
  },
  'corrupt-progress': {
    startedAt: '2026-06-21T00:00:00.000Z',
    launcher: {
      workers: [{ start: 9, end: 10 }],
    },
    progressRaw: {
      'uid-pipeline-9-10.json': '{not-json',
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['default-state', 'parseint-worker-prefix', 'corrupt-progress'];

function resolvePayload({ fixture = 'default-state', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default-state');
  return { name, payload: UID_PIPELINE_STATE_FIXTURES[name] || DEFAULT_PAYLOAD };
}

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
  const rawProgress = payload.progressRaw && typeof payload.progressRaw === 'object' && !Array.isArray(payload.progressRaw) ? payload.progressRaw : {};
  await Promise.all([
    ...Object.entries(progress).map(([file, filePayload]) => writeFile(join(dataDir, file), JSON.stringify(filePayload || {}, null, 2), 'utf8')),
    ...Object.entries(rawProgress).map(([file, rawPayload]) => writeFile(join(dataDir, file), String(rawPayload), 'utf8')),
  ]);
}

export async function compareUidPipelineState({
  fixture = 'default-state',
  fixtureNames,
  payload,
  runJs = runJsState,
  runPython = runPythonState,
} = {}) {
  if (fixtureNames) return compareUidPipelineStateSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-pipeline-state-compare-'));
  try {
    const dataDir = resolved.payload.dataDir || join(tempDir, 'data');
    if (!resolved.payload.dataDir) await writeFixture(dataDir, resolved.payload);
    const context = { payload: resolved.payload, fixture: { name: resolved.name }, dataDir };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareUidPipelineStateObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, dataDir },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareUidPipelineStateSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsState,
  runPython = runPythonState,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidPipelineState({ fixture, runJs, runPython }));
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
  const result = await compareUidPipelineStateSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
