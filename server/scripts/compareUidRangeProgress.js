import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['range', 'discovery', 'phase2', 'comments'];

export const DEFAULT_PAYLOAD = {
  start: 200000,
  end: 300000,
  progressFile: 'batch-uid-range-progress.json',
  progress: {
    scannedBvids: ['BV1', 'BV2'],
    _uidComments: {
      199999: [{ message: 'outside', bvid: 'BV1' }],
      200000: [{ message: 'inside one', bvid: 'BV1' }, { message: 'inside two', bvid: 'BV2' }],
      250000: [{ message: 'inside', bvid: 'BV2' }],
      300001: [{ message: 'outside', bvid: 'BV2' }],
    },
    processedUids: {
      200000: 'success',
      250000: 'error: lock',
      300001: 'success',
    },
    stats: { videosScanned: 2, uidsFound: 4, targetUidsFound: 2, commentsCollected: 5, analyzed: 1, skipped: 1, errors: 1 },
    lastUpdated: '2026-06-19T00:00:00.000Z',
  },
};

export const UID_RANGE_PROGRESS_FIXTURES = {
  'default-range': DEFAULT_PAYLOAD,
  'parseint-stats-prefix': {
    start: 200000,
    end: 300000,
    progressFile: 'batch-uid-range-progress.json',
    progress: {
      scannedBvids: ['BV1', 'BV2'],
      _uidComments: {
        199999: [{ message: 'outside', bvid: 'BV1' }],
        200000: [{ message: 'inside one', bvid: 'BV1' }, { message: 'inside two', bvid: 'BV2' }],
        250000: [{ message: 'inside', bvid: 'BV2' }],
        300001: [{ message: 'outside', bvid: 'BV2' }],
      },
      processedUids: {
        200000: 'success',
        250000: 'error: lock',
        300001: 'success',
      },
      stats: { videosScanned: '2videos', uidsFound: '4uids', targetUidsFound: '2targets', commentsCollected: '5comments', skipped: '1skip' },
    },
  },
  'corrupt-input': {
    start: 200000,
    end: 300000,
    progressFile: 'batch-uid-range-progress.json',
    progressRaw: '{not-json',
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(UID_RANGE_PROGRESS_FIXTURES);

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidRangeProgressObjects(pythonResult = {}, jsResult = {}) {
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

function inRange(uid, start, end) {
  const value = Number.parseInt(String(uid), 10);
  return Number.isFinite(value) && start <= value && value <= end;
}

async function runJsProgress({ progressPath, start, end }) {
  const progress = await readJson(progressPath, {});
  const uidComments = progress._uidComments && typeof progress._uidComments === 'object' && !Array.isArray(progress._uidComments) ? progress._uidComments : {};
  const processedUids =
    progress.processedUids && typeof progress.processedUids === 'object' && !Array.isArray(progress.processedUids) ? progress.processedUids : {};
  const stats = progress.stats && typeof progress.stats === 'object' && !Array.isArray(progress.stats) ? progress.stats : {};
  const targetUids = Object.keys(uidComments).filter((uid) => inRange(uid, start, end));
  const processedTargetEntries = Object.entries(processedUids).filter(([uid]) => inRange(uid, start, end));
  const targetCommentTotal = Object.entries(uidComments).reduce((total, [uid, comments]) => {
    if (!inRange(uid, start, end) || !Array.isArray(comments)) return total;
    return total + comments.length;
  }, 0);
  const successCount = processedTargetEntries.filter(([, status]) => status === 'success').length;
  const errorCount = processedTargetEntries.filter(([, status]) => String(status).startsWith('error')).length;
  const videosScanned = stats.videosScanned ? intOrZero(stats.videosScanned) : Array.isArray(progress.scannedBvids) ? progress.scannedBvids.length : 0;
  const targetUidsDiscovered = stats.targetUidsFound ? intOrZero(stats.targetUidsFound) : targetUids.length;
  const commentsCollected = stats.commentsCollected ? intOrZero(stats.commentsCollected) : 0;
  const skipped = stats.skipped ? intOrZero(stats.skipped) : 0;

  return {
    ok: true,
    range: { start, end },
    discovery: {
      videosScanned,
      uidsDiscovered: Object.keys(uidComments).length,
      targetUidsDiscovered,
      commentsCollected,
    },
    phase2: {
      processed: processedTargetEntries.length,
      success: successCount,
      errors: errorCount,
      skipped,
      remaining: Math.max(0, targetUids.length - processedTargetEntries.length),
    },
    comments: {
      totalForTargetUids: targetCommentTotal,
      averagePerTargetUid: targetUids.length ? Math.round((targetCommentTotal / targetUids.length) * 100) / 100 : 0,
    },
  };
}

async function runPythonProgress({ progressPath, start, end }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.uid_range_progress', '--progress', progressPath, '--start', String(start), '--end', String(end)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonProgressComparison({ progressPath, start, end, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.uid_range_progress',
      '--progress',
      progressPath,
      '--start',
      String(start),
      '--end',
      String(end),
      '--compare-js-report',
      jsReportPath,
    ],
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
  await writeFile(progressPath, 'progressRaw' in payload ? String(payload.progressRaw ?? '') : JSON.stringify(payload.progress || {}, null, 2), 'utf8');
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-range';
  return { name, payload: UID_RANGE_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareUidRangeProgressSingle({
  payload,
  fixture,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-range-progress-compare-'));
  try {
    const fixturePayload = resolved.payload;
    const progressFile = fixturePayload.progressFile || DEFAULT_PAYLOAD.progressFile;
    const progressPath = fixturePayload.progressPath || join(tempDir, progressFile);
    const start = Number.parseInt(String(fixturePayload.start ?? DEFAULT_PAYLOAD.start), 10) || DEFAULT_PAYLOAD.start;
    const end = Number.parseInt(String(fixturePayload.end ?? DEFAULT_PAYLOAD.end), 10) || DEFAULT_PAYLOAD.end;
    if (!fixturePayload.progressPath) await writeFixture(progressPath, fixturePayload);
    const context = { payload: fixturePayload, fixture: { name: resolved.name }, progressPath, progressFile, start, end };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, progressPath, start, end, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareUidRangeProgress({
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
      results.push(await compareUidRangeProgressSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareUidRangeProgressSingle({ payload, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareUidRangeProgress({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
