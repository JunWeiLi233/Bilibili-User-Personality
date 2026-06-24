import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'progress', 'database', 'timestamps'];

export const DEFAULT_PAYLOAD = {
  mode: 'uid-range',
  progressFile: 'batch-scrape-progress.json',
  databaseFile: 'aicu-user-database.json',
  startUid: 100,
  endUid: 110,
  pages: 50,
  progress: {
    lastUid: 105,
    completed: 3,
    errors: [{ uid: '104', error: 'blocked' }, { uid: '105', error: 'timeout' }],
    startTime: '2026-06-19T00:00:00.000Z',
    endTime: '2026-06-19T00:10:00.000Z',
  },
  database: {
    users: {
      100: { commentCount: 2, danmakuCount: 1, comments: [{ message: 'a' }, { message: 'b' }], danmaku: [{ content: 'c' }] },
      101: { commentText: 'one\ntwo', danmakuText: 'dm' },
    },
    lastUpdated: '2026-06-19T00:11:00.000Z',
  },
};

export const BATCH_SCRAPE_PROGRESS_FIXTURES = {
  'uid-range-default': DEFAULT_PAYLOAD,
  'popular-progress': {
    mode: 'popular',
    progressFile: 'batch-scrape-popular-progress.json',
    databaseFile: 'aicu-user-database.json',
    pages: 5,
    progress: {
      scraped: 4,
      videosScanned: 40,
      pagesScanned: 2,
      startTime: 'start',
      endTime: 'end',
    },
    database: {
      users: {
        200: { comments: [{ message: 'x' }] },
        201: { danmaku: [{ content: 'y' }, { content: 'z' }] },
      },
    },
  },
  'corrupt-inputs': {
    mode: 'uid-range',
    progressFile: 'batch-scrape-progress.json',
    databaseFile: 'aicu-user-database.json',
    startUid: 1,
    endUid: 3,
    progressRaw: '{"lastUid": ',
    databaseRaw: '{"users": ',
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(BATCH_SCRAPE_PROGRESS_FIXTURES);

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBatchScrapeProgressObjects(pythonResult = {}, jsResult = {}) {
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

function countComments(user = {}) {
  if (Array.isArray(user.comments)) return user.comments.length;
  if (Number.isInteger(user.commentCount)) return user.commentCount;
  if (user.commentText) return String(user.commentText).split(/\r?\n/).filter((line) => line.trim()).length;
  return 0;
}

function countDanmaku(user = {}) {
  if (Array.isArray(user.danmaku)) return user.danmaku.length;
  if (Number.isInteger(user.danmakuCount)) return user.danmakuCount;
  if (user.danmakuText) return String(user.danmakuText).split(/\r?\n/).filter((line) => line.trim()).length;
  return 0;
}

function databaseSummary(database = {}) {
  const users = database.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  let comments = 0;
  let danmaku = 0;
  let withComments = 0;
  for (const user of Object.values(users)) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
    const commentCount = countComments(user);
    const danmakuCount = countDanmaku(user);
    comments += commentCount;
    danmaku += danmakuCount;
    if (commentCount > 0) withComments += 1;
  }
  return { users: Object.keys(users).length, withComments, comments, danmaku };
}

async function runJsProgress({ dataDir, progressFile, databaseFile, mode, startUid, endUid, pages }) {
  const progressPayload = await readJson(join(dataDir, progressFile), {});
  const database = await readJson(join(dataDir, databaseFile), {});
  const progress =
    mode === 'popular'
      ? {
          scraped: intOrZero(progressPayload.scraped),
          videosScanned: intOrZero(progressPayload.videosScanned),
          pagesScanned: intOrZero(progressPayload.pagesScanned),
          remainingPages: Math.max(0, pages - intOrZero(progressPayload.pagesScanned)),
          targetPages: pages,
        }
      : {
          lastUid: intOrZero(progressPayload.lastUid),
          completed: intOrZero(progressPayload.completed),
          errors: Array.isArray(progressPayload.errors) ? progressPayload.errors.length : 0,
          remaining: Math.max(0, endUid - Math.max(intOrZero(progressPayload.lastUid), startUid - 1)),
          rangeTotal: Math.max(0, endUid - startUid + 1),
        };
  return {
    ok: true,
    mode,
    progress,
    database: databaseSummary(database),
    timestamps: {
      startTime: progressPayload.startTime || null,
      endTime: progressPayload.endTime || null,
      lastUpdated: database.lastUpdated || null,
    },
  };
}

async function runPythonProgress({ dataDir, progressFile, databaseFile, mode, startUid, endUid, pages }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.batch_scrape_progress',
      '--data-dir',
      dataDir,
      '--progress-file',
      progressFile,
      '--database-file',
      databaseFile,
      '--mode',
      mode,
      '--start-uid',
      String(startUid),
      '--end-uid',
      String(endUid),
      '--pages',
      String(pages),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonProgressComparison({ dataDir, progressFile, databaseFile, mode, startUid, endUid, pages, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.batch_scrape_progress',
      '--data-dir',
      dataDir,
      '--progress-file',
      progressFile,
      '--database-file',
      databaseFile,
      '--mode',
      mode,
      '--start-uid',
      String(startUid),
      '--end-uid',
      String(endUid),
      '--pages',
      String(pages),
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

async function writeFixture(dataDir, payload) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, payload.progressFile || DEFAULT_PAYLOAD.progressFile),
    'progressRaw' in payload ? String(payload.progressRaw ?? '') : JSON.stringify(payload.progress || {}, null, 2),
    'utf8',
  );
  await writeFile(
    join(dataDir, payload.databaseFile || DEFAULT_PAYLOAD.databaseFile),
    'databaseRaw' in payload ? String(payload.databaseRaw ?? '') : JSON.stringify(payload.database || { users: {} }, null, 2),
    'utf8',
  );
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'uid-range-default';
  return { name, payload: BATCH_SCRAPE_PROGRESS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareBatchScrapeProgressSingle({
  payload,
  fixture,
  runJs = runJsProgress,
  runPython = runPythonProgress,
  runCompare = runPythonProgressComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-scrape-progress-compare-'));
  try {
    const fixturePayload = resolved.payload;
    const dataDir = fixturePayload.dataDir || join(tempDir, 'data');
    const progressFile = fixturePayload.progressFile || DEFAULT_PAYLOAD.progressFile;
    const databaseFile = fixturePayload.databaseFile || DEFAULT_PAYLOAD.databaseFile;
    const mode = fixturePayload.mode || DEFAULT_PAYLOAD.mode;
    const startUid = Number.parseInt(String(fixturePayload.startUid ?? DEFAULT_PAYLOAD.startUid), 10) || DEFAULT_PAYLOAD.startUid;
    const endUid = Number.parseInt(String(fixturePayload.endUid ?? DEFAULT_PAYLOAD.endUid), 10) || DEFAULT_PAYLOAD.endUid;
    const pages = Number.parseInt(String(fixturePayload.pages ?? DEFAULT_PAYLOAD.pages), 10) || DEFAULT_PAYLOAD.pages;
    if (!fixturePayload.dataDir) await writeFixture(dataDir, fixturePayload);
    const context = { payload: fixturePayload, fixture: { name: resolved.name }, dataDir, progressFile, databaseFile, mode, startUid, endUid, pages };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, dataDir, progressFile, databaseFile, mode, startUid, endUid, pages, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareBatchScrapeProgress({
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
      results.push(await compareBatchScrapeProgressSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareBatchScrapeProgressSingle({ payload, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareBatchScrapeProgress({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
