import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function runJsFileLockState({ lockPath, staleMs = DEFAULT_STALE_MS }) {
  const owner = await readOwner(lockPath);
  const exists = owner !== null;
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

async function writeFixture(lockPath, owner) {
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify(owner || DEFAULT_OWNER, null, 2)}\n`, 'utf8');
}

export async function compareFileLockState({
  owner = DEFAULT_OWNER,
  staleMs = DEFAULT_STALE_MS,
  runJs = runJsFileLockState,
  runPython = runPythonFileLockState,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'file-lock-state-compare-'));
  try {
    const lockPath = join(tempDir, '.fixture.lock');
    await writeFixture(lockPath, owner);
    const context = { owner, lockPath, staleMs };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareFileLockStateObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { lockPath, staleMs },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareFileLockState();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
