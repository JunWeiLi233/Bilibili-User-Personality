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
      lastUpdated: database.lastUpdated,
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

async function writeFixture(dataDir, payload) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, payload.progressFile || DEFAULT_PAYLOAD.progressFile), JSON.stringify(payload.progress || {}, null, 2), 'utf8');
  await writeFile(join(dataDir, payload.databaseFile || DEFAULT_PAYLOAD.databaseFile), JSON.stringify(payload.database || { users: {} }, null, 2), 'utf8');
}

export async function compareBatchScrapeProgress({ payload = DEFAULT_PAYLOAD, runJs = runJsProgress, runPython = runPythonProgress } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'batch-scrape-progress-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'data');
    const progressFile = payload.progressFile || DEFAULT_PAYLOAD.progressFile;
    const databaseFile = payload.databaseFile || DEFAULT_PAYLOAD.databaseFile;
    const mode = payload.mode || DEFAULT_PAYLOAD.mode;
    const startUid = Number.parseInt(String(payload.startUid ?? DEFAULT_PAYLOAD.startUid), 10) || DEFAULT_PAYLOAD.startUid;
    const endUid = Number.parseInt(String(payload.endUid ?? DEFAULT_PAYLOAD.endUid), 10) || DEFAULT_PAYLOAD.endUid;
    const pages = Number.parseInt(String(payload.pages ?? DEFAULT_PAYLOAD.pages), 10) || DEFAULT_PAYLOAD.pages;
    if (!payload.dataDir) await writeFixture(dataDir, payload);
    const context = { payload, dataDir, progressFile, databaseFile, mode, startUid, endUid, pages };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareBatchScrapeProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { dataDir, progressFile, databaseFile, mode, startUid, endUid, pages },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareBatchScrapeProgress();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
