import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['discovery', 'pipeline', 'combined'];
const MERGE_STAT_KEYS = ['success', 'noComments', 'noUser', 'trainError', 'blocked', 'errors'];

export const DEFAULT_PAYLOAD = {
  totalStart: 1,
  totalEnd: 4,
  workers: 2,
  pipelineRatePerMinute: 2,
  discovery: { stats: { uidsAnalyzed: 4, uidsFound: 10, errors: 2 } },
  pipeline: {
    'uid-pipeline-1-2.json': { processed: { 1: 'success', 2: 'no_comments' }, stats: { success: 1, noComments: 1 } },
    'uid-pipeline-3-4.json': { processed: { 3: 'no_videos' }, stats: { noVideos: 1, errors: 1 } },
  },
};

function intOrZero(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareScraperMonitorObjects(pythonResult = {}, jsResult = {}) {
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

function progressFiles({ totalStart, totalEnd, workers }) {
  const totalExpected = Math.max(0, totalEnd - totalStart + 1);
  const chunkSize = totalExpected ? Math.ceil(totalExpected / Math.max(1, workers)) : 0;
  const files = [];
  for (let workerIndex = 0; workerIndex < Math.max(1, workers); workerIndex += 1) {
    const start = totalStart + workerIndex * chunkSize;
    const end = Math.min(start + chunkSize - 1, totalEnd);
    if (start > totalEnd) break;
    files.push(`uid-pipeline-${start}-${end}.json`);
  }
  return files;
}

async function runJsMonitor({ dataDir, totalStart, totalEnd, workers, pipelineRatePerMinute }) {
  const discoveryPayload = await readJson(join(dataDir, 'uid-discovery-progress.json'), {});
  const discoveryStats = discoveryPayload.stats && typeof discoveryPayload.stats === 'object' && !Array.isArray(discoveryPayload.stats) ? discoveryPayload.stats : {};
  const discovery = {
    analyzed: intOrZero(discoveryStats.uidsAnalyzed),
    found: intOrZero(discoveryStats.uidsFound),
    remaining: intOrZero(discoveryStats.uidsFound) - intOrZero(discoveryStats.uidsAnalyzed),
    errors: intOrZero(discoveryStats.errors),
  };

  const mergedStats = Object.fromEntries(MERGE_STAT_KEYS.map((key) => [key, 0]));
  let totalProcessed = 0;
  let totalNoVideos = 0;
  for (const file of progressFiles({ totalStart, totalEnd, workers })) {
    const payload = await readJson(join(dataDir, file), {});
    const processed = payload.processed && typeof payload.processed === 'object' && !Array.isArray(payload.processed) ? payload.processed : {};
    const stats = payload.stats && typeof payload.stats === 'object' && !Array.isArray(payload.stats) ? payload.stats : {};
    if (Object.keys(processed).length > 0) {
      totalProcessed += Object.keys(processed).length;
      for (const key of MERGE_STAT_KEYS) mergedStats[key] += intOrZero(stats[key]);
    }
    totalNoVideos += intOrZero(stats.noVideos);
  }

  const totalExpected = Math.max(0, totalEnd - totalStart + 1);
  const remaining = Math.max(0, totalExpected - totalProcessed);
  const pipeline = {
    processed: totalProcessed,
    success: mergedStats.success,
    noComments: mergedStats.noComments,
    noVideos: totalNoVideos,
    noUser: mergedStats.noUser,
    errors: mergedStats.errors,
    remaining,
    etaMinutes: Math.ceil(remaining / Math.max(1, pipelineRatePerMinute)),
    etaHours: Math.round((remaining / Math.max(1, pipelineRatePerMinute) / 60) * 10) / 10,
  };
  return { ok: true, discovery, pipeline, combined: { uidsAnalyzed: discovery.analyzed + pipeline.success } };
}

async function runPythonMonitor({ dataDir, totalStart, totalEnd, workers, pipelineRatePerMinute }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.scraper_monitor',
      '--data-dir',
      dataDir,
      '--total-start',
      String(totalStart),
      '--total-end',
      String(totalEnd),
      '--workers',
      String(workers),
      '--pipeline-rate-per-minute',
      String(pipelineRatePerMinute),
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
  await writeFile(join(dataDir, 'uid-discovery-progress.json'), JSON.stringify(payload.discovery || {}, null, 2), 'utf8');
  const pipeline = payload.pipeline && typeof payload.pipeline === 'object' && !Array.isArray(payload.pipeline) ? payload.pipeline : {};
  await Promise.all(
    Object.entries(pipeline).map(([file, filePayload]) => writeFile(join(dataDir, file), JSON.stringify(filePayload || {}, null, 2), 'utf8')),
  );
}

export async function compareScraperMonitor({ payload = DEFAULT_PAYLOAD, runJs = runJsMonitor, runPython = runPythonMonitor } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'scraper-monitor-compare-'));
  try {
    const dataDir = payload.dataDir || join(tempDir, 'data');
    const totalStart = Number.parseInt(String(payload.totalStart ?? DEFAULT_PAYLOAD.totalStart), 10) || 0;
    const totalEnd = Number.parseInt(String(payload.totalEnd ?? DEFAULT_PAYLOAD.totalEnd), 10) || 0;
    const workers = Math.max(1, Number.parseInt(String(payload.workers ?? DEFAULT_PAYLOAD.workers), 10) || 1);
    const pipelineRatePerMinute = Math.max(
      1,
      Number.parseInt(String(payload.pipelineRatePerMinute ?? DEFAULT_PAYLOAD.pipelineRatePerMinute), 10) || 1,
    );
    if (!payload.dataDir) await writeFixture(dataDir, payload);
    const context = { payload, dataDir, totalStart, totalEnd, workers, pipelineRatePerMinute };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareScraperMonitorObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { dataDir, totalStart, totalEnd, workers, pipelineRatePerMinute },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareScraperMonitor();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
