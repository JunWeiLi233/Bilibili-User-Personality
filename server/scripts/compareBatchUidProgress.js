import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['discovery', 'phase2', 'comments', 'stats'];

export const DEFAULT_PAYLOAD = {
  scannedBvids: ['BV1', 'BV2', 'BV3'],
  _uidComments: {
    100: [{ message: 'one', bvid: 'BV1' }, { message: 'two', bvid: 'BV2' }],
    101: [{ message: 'three', bvid: 'BV2' }],
    102: [],
  },
  processedUids: { 100: 'success', 101: 'error_timeout', 102: 'no_text' },
  stats: { videosScanned: 3, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 2 },
  lastUpdated: '2026-06-19T00:00:00.000Z',
};

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBatchUidProgressObjects(pythonResult = {}, jsResult = {}) {
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

async function runJsProgress({ progressPath }) {
  const progress = await readJson(progressPath, {});
  const uidComments = progress._uidComments && typeof progress._uidComments === 'object' && !Array.isArray(progress._uidComments) ? progress._uidComments : {};
  const processedUids =
    progress.processedUids && typeof progress.processedUids === 'object' && !Array.isArray(progress.processedUids) ? progress.processedUids : {};
  const stats = progress.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
  const commentLists = Object.values(uidComments).filter((comments) => Array.isArray(comments));
  const commentTotal = commentLists.reduce((total, comments) => total + comments.length, 0);
  const uidCount = Object.keys(uidComments).length;
  const successCount = Object.values(processedUids).filter((status) => status === 'success').length;
  const errorCount = Object.values(processedUids).filter((status) => String(status).startsWith('error')).length;
  const skippedCount = Object.values(processedUids).filter((status) => status === 'no_text').length;
  const videosScanned = intOrZero(stats.videosScanned) || (Array.isArray(progress.scannedBvids) ? progress.scannedBvids.length : 0);
  const normalizedStats = {
    videosScanned,
    uidsFound: intOrZero(stats.uidsFound) || uidCount,
    uidsAnalyzed: intOrZero(stats.uidsAnalyzed) || successCount,
    commentsCollected: intOrZero(stats.commentsCollected),
    errors: intOrZero(stats.errors),
  };
  return {
    ok: true,
    discovery: {
      videosScanned: normalizedStats.videosScanned,
      uidsDiscovered: uidCount,
      commentsCollected: normalizedStats.commentsCollected,
    },
    phase2: {
      processed: Object.keys(processedUids).length,
      success: successCount,
      errors: errorCount,
      skipped: skippedCount,
      remaining: Math.max(0, uidCount - Object.keys(processedUids).length),
    },
    comments: {
      total: commentTotal,
      averagePerUid: uidCount ? Math.round((commentTotal / uidCount) * 100) / 100 : 0,
      uidsWithComments: commentLists.filter((comments) => comments.length > 0).length,
    },
    stats: normalizedStats,
  };
}

async function runPythonProgress({ progressPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.batch_uid_progress', '--progress', progressPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(progressPath, payload) {
  await mkdir(dirname(progressPath), { recursive: true });
  await writeFile(progressPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareBatchUidProgress({ payload = DEFAULT_PAYLOAD, runJs = runJsProgress, runPython = runPythonProgress } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-uid-progress-compare-'));
  try {
    const progressPath = payload.progressPath || join(tempDir, 'batch-uid-progress.json');
    if (!payload.progressPath) await writeFixture(progressPath, payload);
    const context = { payload, progressPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareBatchUidProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { progressPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareBatchUidProgress();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
