import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readJsonCorpus, writeJsonCorpus } from '../services/splitCorpusStorage.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['manifest', 'comments', 'runs'];
const MANIFEST_KEYS = [
  'version',
  'updatedAt',
  'source',
  'storage',
  'shardMaxBytes',
  'commentFiles',
  'commentCount',
  'runFiles',
  'runCount',
];

export const CORPUS_SHARD_WRITE_FIXTURES = {
  'split-comments-and-runs': {
    payload: {
      maxShardBytes: 1024,
      manifest: { version: 7, updatedAt: '2026-06-19T00:00:00.000Z', source: 'bridge' },
      comments: [{ message: 'alpha'.repeat(80) }, { message: 'beta' }],
      runs: [{ at: 'round-1' }],
    },
  },
  'empty-corpus': {
    payload: {
      maxShardBytes: 2048,
      manifest: { version: 1, updatedAt: 'empty', source: 'empty-fixture' },
      comments: [],
      runs: [],
    },
  },
  'invalid-options': {
    payload: {
      maxShardBytes: 'not-a-number',
      manifest: { version: 3, source: 'invalid-options' },
      comments: { bad: true },
      runs: [{ at: 'kept-run' }],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(CORPUS_SHARD_WRITE_FIXTURES);

function summarizeManifest(manifest = {}) {
  return Object.fromEntries(MANIFEST_KEYS.filter((key) => key in manifest).map((key) => [key, manifest[key]]));
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

function normalizePayloadForOutput(payload = {}, outputPath) {
  return {
    ...payload,
    outputPath,
    comments: Array.isArray(payload.comments) ? payload.comments : [],
    runs: Array.isArray(payload.runs) ? payload.runs : [],
    manifest: payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : {},
  };
}

export function compareCorpusShardWriteObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsCorpusShardWrite({ payload }) {
  await writeJsonCorpus(payload.outputPath, {
    ...(payload.manifest || {}),
    comments: payload.comments,
    runs: payload.runs,
  }, { maxShardBytes: payload.maxShardBytes });
  const loaded = await readJsonCorpus(payload.outputPath);
  return {
    ok: true,
    outputPath: payload.outputPath,
    manifest: summarizeManifest(loaded),
    comments: Array.isArray(loaded.comments) ? loaded.comments.length : 0,
    runs: Array.isArray(loaded.runs) ? loaded.runs.length : 0,
  };
}

async function runPythonCorpusShardWrite({ payloadPath, jsReportPath }) {
  const baseArgs = ['-m', 'python_backend.cli.corpus_shard_writer', '--payload', payloadPath];
  const rawResult = await execFileAsync('python', baseArgs, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  const compareResult = await execFileAsync('python', [...baseArgs, '--compare-js-report', jsReportPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { raw: JSON.parse(rawResult.stdout), comparison: JSON.parse(compareResult.stdout) };
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || DEFAULT_FIXTURE_NAMES[0];
  const resolved = CORPUS_SHARD_WRITE_FIXTURES[name] || CORPUS_SHARD_WRITE_FIXTURES[DEFAULT_FIXTURE_NAMES[0]];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareCorpusShardWriteSingle({
  payload,
  fixture,
  runJs = runJsCorpusShardWrite,
  runPython = runPythonCorpusShardWrite,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'corpus-shard-write-compare-'));
  try {
    const jsOutputPath = join(tempDir, 'js', 'corpus.json');
    const pythonOutputPath = join(tempDir, 'python', 'corpus.json');
    const jsPayload = normalizePayloadForOutput(resolved.payload, jsOutputPath);
    const pythonPayload = normalizePayloadForOutput(resolved.payload, pythonOutputPath);
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(payloadPath, JSON.stringify(pythonPayload, null, 2), 'utf8');
    const context = {
      payload: pythonPayload,
      jsPayload,
      payloadPath,
      jsReportPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = (await runJs({ ...context, payload: jsPayload })) || {};
    await writeFile(jsReportPath, JSON.stringify(js, null, 2), 'utf8');
    const python = (await runPython(context)) || {};
    const pythonRaw = python.raw || python;
    const pythonComparison = python.comparison || {};
    const comparison = compareCorpusShardWriteObjects(pythonRaw, js);
    return {
      ok: (pythonComparison.ok ?? true) && comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python: pythonRaw,
      comparison: pythonComparison,
      mismatches: pythonComparison.mismatches?.length ? pythonComparison.mismatches : comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareCorpusShardWrite({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsCorpusShardWrite,
  runPython = runPythonCorpusShardWrite,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareCorpusShardWriteSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareCorpusShardWriteSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareCorpusShardWrite({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
