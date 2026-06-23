import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['phase', 'discovery', 'analysis', 'comments', 'stats', 'userDb'];

export const DEFAULT_PAYLOAD = {
  progress: {
    scannedBvids: ['BV1', 'BV2'],
    processedUids: { 100: 'success', 101: 'error_timeout', 102: 'no_text' },
    stats: { videosScanned: 2, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 1 },
    phase: 'analysis',
    videoQueueSize: 7,
    lastUpdated: '2026-06-19T00:00:00.000Z',
  },
  comments: {
    100: [{ message: 'one' }, { message: 'two' }],
    101: [{ message: 'three' }],
    102: [],
  },
  database: { users: { 100: {}, 101: {} } },
};

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidDiscoveryProgressObjects(pythonResult = {}, jsResult = {}) {
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

async function runJsProgress({ dataDir }) {
  const progressPayload = await readJson(join(dataDir, 'uid-discovery-progress.json'), {});
  const comments = await readJson(join(dataDir, 'uid-discovery-comments.json'), {});
  const database = await readJson(join(dataDir, 'scraped-users-db.json'), {});
  const processedUids =
    progressPayload.processedUids && typeof progressPayload.processedUids === 'object' && !Array.isArray(progressPayload.processedUids)
      ? progressPayload.processedUids
      : {};
  const stats = progressPayload.stats && typeof progressPayload.stats === 'object' && !Array.isArray(progressPayload.stats) ? progressPayload.stats : {};
  const scannedBvids = Array.isArray(progressPayload.scannedBvids) ? progressPayload.scannedBvids : [];
  const users = database.users && typeof database.users === 'object' && !Array.isArray(database.users) ? database.users : {};
  const uidCount = Object.keys(comments).length;
  const commentLists = Object.values(comments).filter((entries) => Array.isArray(entries));
  const commentTotal = commentLists.reduce((total, entries) => total + entries.length, 0);
  const successCount = Object.values(processedUids).filter((status) => status === 'success').length;
  const errorCount = Object.values(processedUids).filter((status) => String(status).startsWith('error')).length;
  const skippedCount = Object.values(processedUids).filter((status) => status === 'no_text').length;
  const videosScanned = intOrZero(stats.videosScanned) || scannedBvids.length;

  return {
    ok: true,
    phase: progressPayload.phase || 'discovery',
    discovery: {
      videosScanned,
      videoQueueSize: intOrZero(progressPayload.videoQueueSize),
      uidsDiscovered: intOrZero(stats.uidsFound) || uidCount,
      commentsCollected: intOrZero(stats.commentsCollected),
    },
    analysis: {
      processed: Object.keys(processedUids).length,
      success: successCount,
      errors: errorCount,
      skipped: skippedCount,
      remaining: Math.max(0, uidCount - Object.keys(processedUids).length),
    },
    comments: {
      total: commentTotal,
      averagePerUid: uidCount ? Math.round((commentTotal / uidCount) * 100) / 100 : 0,
      uidsWithComments: commentLists.filter((entries) => entries.length > 0).length,
    },
    stats: {
      videosScanned,
      uidsFound: intOrZero(stats.uidsFound) || uidCount,
      uidsAnalyzed: intOrZero(stats.uidsAnalyzed) || successCount,
      commentsCollected: intOrZero(stats.commentsCollected),
      errors: intOrZero(stats.errors),
    },
    userDb: { users: Object.keys(users).length },
  };
}

async function runPythonProgress({ dataDir }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_discovery_progress', '--data-dir', dataDir], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(dataDir, payload) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'uid-discovery-progress.json'), JSON.stringify(payload.progress || {}, null, 2), 'utf8');
  await writeFile(join(dataDir, 'uid-discovery-comments.json'), JSON.stringify(payload.comments || {}, null, 2), 'utf8');
  await writeFile(join(dataDir, 'scraped-users-db.json'), JSON.stringify(payload.database || { users: {} }, null, 2), 'utf8');
}

export async function compareUidDiscoveryProgress({ payload = DEFAULT_PAYLOAD, runJs = runJsProgress, runPython = runPythonProgress } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-discovery-progress-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'data');
    if (!payload.dataDir) await writeFixture(dataDir, payload);
    const context = { payload, dataDir };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareUidDiscoveryProgressObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { dataDir },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareUidDiscoveryProgress();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
