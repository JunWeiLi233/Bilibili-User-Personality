import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['worker', 'progress', 'stats', 'statusCounts', 'userDb'];

export const DEFAULT_PAYLOAD = {
  worker: 1,
  workers: 2,
  comments: {
    100: [{ message: 'a' }],
    101: [{ message: 'b' }],
    102: [{ message: 'c' }],
    103: [{ message: 'd' }],
  },
  progress: {
    processed: { 101: 'success', 103: 'no_text' },
    stats: { success: 1, noText: 1, errors: 0 },
  },
  database: {
    users: {
      101: { uid: '101' },
      999: { uid: '999' },
    },
  },
};

export const UID_PARALLEL_PROGRESS_FIXTURES = {
  'default-progress': DEFAULT_PAYLOAD,
  'corrupt-inputs': {
    worker: 1,
    workers: 2,
    commentsRaw: '{not-json',
    progressRaw: '{not-json',
    databaseRaw: '{not-json',
  },
};

const DEFAULT_FIXTURE_NAMES = ['default-progress', 'corrupt-inputs'];

function resolvePayload({ fixture = 'default-progress', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default-progress');
  return { name, payload: UID_PARALLEL_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidParallelProgressObjects(pythonResult = {}, jsResult = {}) {
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
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function statusCounts(processed = {}) {
  return Object.values(processed).reduce((counts, value) => {
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

async function runJsProgress({ dataDir, worker, workers }) {
  const comments = await readJson(join(dataDir, 'uid-discovery-comments.json'), {});
  const progress = await readJson(join(dataDir, `uid-parallel-${worker}-progress.json`), {});
  const database = await readJson(join(dataDir, 'scraped-users-db.json'), {});
  const allComments = comments && typeof comments === 'object' && !Array.isArray(comments) ? comments : {};
  const processed = progress?.processed && typeof progress.processed === 'object' && !Array.isArray(progress.processed) ? progress.processed : {};
  const stats = progress?.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
  const users = database?.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  const assignedUids = Object.keys(allComments).filter((_, index) => index % Math.max(1, workers) === worker);
  const assignedSet = new Set(assignedUids);
  const assigned = assignedUids.length;
  const processedCount = Object.keys(processed).length;
  return {
    ok: true,
    worker: { id: worker, totalWorkers: Math.max(1, workers), assigned },
    progress: {
      processed: processedCount,
      remaining: Math.max(0, assigned - processedCount),
      completionRatio: assigned ? Math.round((processedCount / assigned) * 10000) / 10000 : 0,
    },
    stats: {
      success: intOrZero(stats.success),
      noText: intOrZero(stats.noText),
      errors: intOrZero(stats.errors),
    },
    statusCounts: statusCounts(processed),
    userDb: {
      users: Object.keys(users).length,
      assignedUsersInDb: Object.keys(users).filter((uid) => assignedSet.has(uid)).length,
    },
  };
}

async function runPythonProgress({ dataDir, worker, workers }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.uid_parallel_progress', '--data-dir', dataDir, `--worker=${worker}`, `--workers=${workers}`],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function writeFixture(dataDir, payload) {
  await mkdir(dataDir, { recursive: true });
  const worker = Number.parseInt(String(payload.worker ?? 0), 10) || 0;
  await writeFile(join(dataDir, 'uid-discovery-comments.json'), payload.commentsRaw ?? JSON.stringify(payload.comments || {}, null, 2), 'utf8');
  await writeFile(join(dataDir, `uid-parallel-${worker}-progress.json`), payload.progressRaw ?? JSON.stringify(payload.progress || {}, null, 2), 'utf8');
  await writeFile(join(dataDir, 'scraped-users-db.json'), payload.databaseRaw ?? JSON.stringify(payload.database || { users: {} }, null, 2), 'utf8');
}

export async function compareUidParallelProgress({
  fixture = 'default-progress',
  fixtureNames,
  payload,
  runJs = runJsProgress,
  runPython = runPythonProgress,
} = {}) {
  if (fixtureNames) return compareUidParallelProgressSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-parallel-progress-compare-'));
  try {
    const dataDir = resolved.payload.dataDir || join(tempDir, 'server', 'data');
    const worker = Number.parseInt(String(resolved.payload.worker ?? 0), 10) || 0;
    const workers = Math.max(1, Number.parseInt(String(resolved.payload.workers ?? 4), 10) || 4);
    if (!resolved.payload.dataDir) await writeFixture(dataDir, resolved.payload);
    const fixtureContext = { name: resolved.name };
    const js = await runJs({ payload: resolved.payload, fixture: fixtureContext, dataDir, worker, workers });
    const python = await runPython({ payload: resolved.payload, fixture: fixtureContext, dataDir, worker, workers });
    const comparison = compareUidParallelProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, dataDir, worker, workers },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareUidParallelProgressSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsProgress,
  runPython = runPythonProgress,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidParallelProgress({ fixture, runJs, runPython }));
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
  const result = await compareUidParallelProgressSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
