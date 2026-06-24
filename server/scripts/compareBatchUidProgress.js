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

export const BATCH_UID_PROGRESS_FIXTURES = {
  'default-state': DEFAULT_PAYLOAD,
  'parseint-stats-prefix': {
    scannedBvids: ['BV1', 'BV2', 'BV3'],
    _uidComments: {
      100: [{ message: 'one', bvid: 'BV1' }, { message: 'two', bvid: 'BV2' }],
      101: [{ message: 'three', bvid: 'BV2' }],
      102: [],
    },
    processedUids: { 100: 'success', 101: 'error_timeout', 102: 'no_text' },
    stats: { videosScanned: '3videos', uidsFound: '3uids', uidsAnalyzed: '1done', commentsCollected: '4comments', errors: '2err' },
  },
  'corrupt-input': {
    progressRaw: '{not-json',
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(BATCH_UID_PROGRESS_FIXTURES);

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

async function runPythonProgressComparison({ progressPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.batch_uid_progress', '--progress', progressPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function writeFixture(progressPath, payload) {
  await mkdir(dirname(progressPath), { recursive: true });
  await writeFile(progressPath, 'progressRaw' in payload ? String(payload.progressRaw ?? '') : JSON.stringify(payload || {}, null, 2), 'utf8');
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-state';
  return { name, payload: BATCH_UID_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareBatchUidProgressSingle({
  payload,
  fixture,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-uid-progress-compare-'));
  try {
    const fixturePayload = resolved.payload;
    const progressPath = fixturePayload.progressPath || join(tempDir, 'batch-uid-progress.json');
    if (!fixturePayload.progressPath) await writeFixture(progressPath, fixturePayload);
    const context = { payload: fixturePayload, fixture: { name: resolved.name }, progressPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, progressPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareBatchUidProgress({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareBatchUidProgressSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareBatchUidProgressSingle({ payload, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareBatchUidProgress({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
