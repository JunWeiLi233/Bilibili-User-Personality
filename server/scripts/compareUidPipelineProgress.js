import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'progress', 'stats', 'statusCounts', 'userDb'];
const STAT_KEYS = ['success', 'noComments', 'noVideos', 'noUser', 'trainError', 'blocked', 'errors'];

export const DEFAULT_PAYLOAD = {
  start: 10,
  end: 14,
  progress: {
    processed: { 10: 'success', 11: 'blocked', 12: 'blocked' },
    stats: { success: 1, blocked: 2, errors: 1 },
    lastUpdated: '2026-06-19T00:00:00.000Z',
  },
  database: {
    users: {
      10: { uid: '10' },
      13: { uid: '13' },
      999: { uid: '999' },
    },
  },
};

export const UID_PIPELINE_PROGRESS_FIXTURES = {
  'default-progress': DEFAULT_PAYLOAD,
  'parseint-uid-prefix': {
    start: 10,
    end: 14,
    progress: {
      processed: { 10: 'success', 11: 'blocked' },
      stats: { success: '1ok', blocked: '1blocked', errors: '2bad' },
    },
    database: {
      users: {
        '10abc': { uid: '10abc' },
        13: { uid: '13' },
        999: { uid: '999' },
      },
    },
  },
  'corrupt-inputs': {
    start: 21,
    end: 23,
    progressRaw: '{not-json',
    databaseRaw: '{not-json',
  },
};

const DEFAULT_FIXTURE_NAMES = ['default-progress', 'parseint-uid-prefix', 'corrupt-inputs'];

function resolvePayload({ fixture = 'default-progress', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default-progress');
  return { name, payload: UID_PIPELINE_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidPipelineProgressObjects(pythonResult = {}, jsResult = {}) {
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

function statusCounts(processed = {}) {
  return Object.values(processed).reduce((counts, value) => {
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function usersInRange(users = {}, start = 0, end = 0) {
  return Object.keys(users).filter((uid) => {
    const numericUid = Number.parseInt(String(uid), 10);
    return Number.isFinite(numericUid) && numericUid >= start && numericUid <= end;
  }).length;
}

async function runJsProgress({ progressPath, userDbPath, start, end }) {
  const progressPayload = await readJson(progressPath, {});
  const database = await readJson(userDbPath, {});
  const processed =
    progressPayload.processed && typeof progressPayload.processed === 'object' && !Array.isArray(progressPayload.processed)
      ? progressPayload.processed
      : {};
  const stats = progressPayload.stats && typeof progressPayload.stats === 'object' && !Array.isArray(progressPayload.stats) ? progressPayload.stats : {};
  const users = database.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  const total = Math.max(0, end - start + 1);
  const processedCount = Object.keys(processed).length;
  return {
    ok: true,
    range: { start, end, total },
    progress: {
      processed: processedCount,
      remaining: Math.max(0, total - processedCount),
      completionRatio: total ? Math.round((processedCount / total) * 10000) / 10000 : 0,
    },
    stats: Object.fromEntries(STAT_KEYS.map((key) => [key, intOrZero(stats[key])])),
    statusCounts: statusCounts(processed),
    userDb: { users: Object.keys(users).length, usersInRange: usersInRange(users, start, end) },
  };
}

async function runPythonProgress({ progressPath, userDbPath, start, end }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.uid_pipeline_progress', '--progress', progressPath, `--start=${start}`, `--end=${end}`, '--user-db', userDbPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function writeFixture(progressPath, userDbPath, payload) {
  await mkdir(dirname(progressPath), { recursive: true });
  await writeFile(progressPath, payload.progressRaw ?? JSON.stringify(payload.progress || {}, null, 2), 'utf8');
  await writeFile(userDbPath, payload.databaseRaw ?? JSON.stringify(payload.database || { users: {} }, null, 2), 'utf8');
}

export async function compareUidPipelineProgress({
  fixture = 'default-progress',
  fixtureNames,
  payload,
  runJs = runJsProgress,
  runPython = runPythonProgress,
} = {}) {
  if (fixtureNames) return compareUidPipelineProgressSuite({ fixtures: fixtureNames, runJs, runPython });
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-pipeline-progress-compare-'));
  try {
    const start = Number.parseInt(String(resolved.payload.start ?? DEFAULT_PAYLOAD.start), 10) || 0;
    const end = Number.parseInt(String(resolved.payload.end ?? DEFAULT_PAYLOAD.end), 10) || 0;
    const progressPath = resolved.payload.progressPath || join(tempDir, `uid-pipeline-${start}-${end}.json`);
    const userDbPath = resolved.payload.userDbPath || join(tempDir, 'scraped-users-db.json');
    if (!resolved.payload.progressPath) await writeFixture(progressPath, userDbPath, resolved.payload);
    const context = { payload: resolved.payload, fixture: { name: resolved.name }, progressPath, userDbPath, start, end };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareUidPipelineProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, progressPath, userDbPath, start, end },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareUidPipelineProgressSuite({
  fixtures = DEFAULT_FIXTURE_NAMES,
  runJs = runJsProgress,
  runPython = runPythonProgress,
} = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidPipelineProgress({ fixture, runJs, runPython }));
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
  const result = await compareUidPipelineProgressSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
