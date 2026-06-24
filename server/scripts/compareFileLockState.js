import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['owner', 'state'];

export const DEFAULT_OWNER = {
  pid: 999999,
  startedAt: '2026-06-19T00:00:00.000Z',
  command: 'node fixture',
};

export const DEFAULT_STALE_MS = 60000;

export const FILE_LOCK_STATE_FIXTURES = {
  'stale-owner': { owner: DEFAULT_OWNER, staleMs: DEFAULT_STALE_MS },
  'missing-owner': { owner: null, staleMs: DEFAULT_STALE_MS },
  'corrupt-owner': { ownerRaw: '{not-json', staleMs: DEFAULT_STALE_MS },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(FILE_LOCK_STATE_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareFileLockStateObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function isProcessAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readOwner(lockPath) {
  try {
    const payload = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runJsFileLockState({ lockPath, staleMs = DEFAULT_STALE_MS }) {
  const owner = await readOwner(lockPath);
  const exists = await pathExists(lockPath);
  const startedAt = Date.parse(owner?.startedAt || '');
  const staleByAge = Number.isFinite(startedAt) && Date.now() - startedAt > staleMs;
  const staleByPid = Boolean(owner?.pid) && !isProcessAlive(owner.pid);
  const stale = Boolean(staleByAge || staleByPid);
  return {
    ok: true,
    lockPath,
    owner: owner
      ? {
          pid: owner.pid,
          startedAt: owner.startedAt,
          command: owner.command,
        }
      : null,
    state: {
      exists,
      hasOwner: owner !== null,
      staleByAge,
      staleByPid,
      stale,
      shouldRemove: Boolean(exists && stale),
    },
  };
}

async function runPythonFileLockState({ lockPath, staleMs = DEFAULT_STALE_MS }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.file_lock_state', '--lock', lockPath, '--stale-ms', String(staleMs)], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonFileLockStateComparison({ lockPath, staleMs = DEFAULT_STALE_MS, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.file_lock_state', '--lock', lockPath, '--stale-ms', String(staleMs), '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function writeFixture(lockPath, owner) {
  await mkdir(lockPath, { recursive: true });
  if (owner === null) return;
  if (owner && typeof owner === 'object' && 'ownerRaw' in owner) {
    await writeFile(join(lockPath, 'owner.json'), String(owner.ownerRaw ?? ''), 'utf8');
    return;
  }
  await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify(owner || DEFAULT_OWNER, null, 2)}\n`, 'utf8');
}

function resolveFixture({ owner, fixture, staleMs } = {}) {
  if (owner !== undefined) return { name: fixture?.name || 'custom', owner, staleMs: staleMs || DEFAULT_STALE_MS };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'stale-owner';
  const resolved = FILE_LOCK_STATE_FIXTURES[name] || FILE_LOCK_STATE_FIXTURES['stale-owner'];
  return { name, owner: resolved.ownerRaw !== undefined ? { ownerRaw: resolved.ownerRaw } : resolved.owner, staleMs: resolved.staleMs || DEFAULT_STALE_MS };
}

async function compareFileLockStateSingle({
  owner,
  fixture,
  staleMs,
  runJs = runJsFileLockState,
  runPython = runPythonFileLockState,
  runCompare = runPythonFileLockStateComparison,
} = {}) {
  const resolved = resolveFixture({ owner, fixture, staleMs });
  const tempDir = await mkdtemp(join(tmpdir(), 'file-lock-state-compare-'));
  try {
    const lockPath = join(tempDir, '.fixture.lock');
    await writeFixture(lockPath, resolved.owner);
    const context = { owner: resolved.owner, fixture: { name: resolved.name }, lockPath, staleMs: resolved.staleMs };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, lockPath, staleMs: resolved.staleMs },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareFileLockState({
  owner,
  fixture,
  fixtureNames,
  staleMs,
  runJs = runJsFileLockState,
  runPython = runPythonFileLockState,
  runCompare = runPythonFileLockStateComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareFileLockStateSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareFileLockStateSingle({ owner: owner === undefined ? DEFAULT_OWNER : owner, fixture, staleMs, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareFileLockState({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
