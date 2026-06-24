import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SUMMARY_KEYS = ['sampleSize', 'seed', 'sampled', 'keywordHits', 'neutral', 'uncovered'];
const CORPUS_KEYS = ['comments', 'runs', 'storage', 'sourceBreakdown'];

export const RANDOM_VERIFICATION_FIXTURES = {
  'emoji-keyword-hit': {
    payload: {
      sampleSize: 1,
      seed: 1,
      corpus: { comments: [{ message: '狗头保命😂' }], runs: [] },
      dictionary: { entries: [{ term: '😂', aliases: ['doge'] }] },
    },
    jsReport: { sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 },
  },
  'emoji-alias-hit': {
    payload: {
      sampleSize: 1,
      seed: 1,
      corpus: { comments: [{ message: '反讽一下😂' }], runs: [] },
      dictionary: { entries: [{ term: '狗头', aliases: ['😂'] }] },
    },
    jsReport: { sampleSize: 1, seed: 1, sampled: 1, keywordHits: 1, neutral: 0, uncovered: 0 },
  },
  'ascii-boundary-neutral': {
    payload: {
      sampleSize: 1,
      seed: 1,
      corpus: { comments: [{ message: 'cmd mode' }], runs: [] },
      dictionary: { entries: [{ term: 'md' }] },
    },
    jsReport: { sampleSize: 1, seed: 1, sampled: 1, keywordHits: 0, neutral: 1, uncovered: 0 },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(RANDOM_VERIFICATION_FIXTURES);

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Math.max(0, Number.isFinite(parsed) ? parsed : fallback);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSourceBreakdown(sourceBreakdown) {
  if (!sourceBreakdown || typeof sourceBreakdown !== 'object' || Array.isArray(sourceBreakdown)) return undefined;
  return Object.fromEntries(
    Object.entries(sourceBreakdown)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([source, value]) => [
        source,
        {
          comments: toNonNegativeInt(value.comments, 0),
          runs: toNonNegativeInt(value.runs, 0),
        },
      ]),
  );
}

function summarizeCorpus(corpus) {
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) return undefined;
  const result = {};
  for (const key of CORPUS_KEYS) {
    if (!(key in corpus)) continue;
    if (key === 'sourceBreakdown') {
      const sourceBreakdown = normalizeSourceBreakdown(corpus[key]);
      if (sourceBreakdown) result.sourceBreakdown = sourceBreakdown;
    } else if (key === 'storage') {
      result.storage = String(corpus.storage || '');
    } else {
      result[key] = toNonNegativeInt(corpus[key], 0);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function summarize(report = {}) {
  const source = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const result = {
    sampleSize: toNonNegativeInt(source.sampleSize, 50),
    seed: toInt(source.seed, 1),
    sampled: toNonNegativeInt(source.sampled, 0),
    keywordHits: toNonNegativeInt(source.keywordHits, 0),
    neutral: toNonNegativeInt(source.neutral, 0),
    uncovered: toNonNegativeInt(source.uncovered, 0),
  };
  const corpus = summarizeCorpus(source.corpus);
  if (corpus) result.corpus = corpus;
  return result;
}

export function compareRandomVerificationObjects(pythonReport = {}, jsReport = {}) {
  const python = summarize(pythonReport);
  const js = summarize(jsReport);
  const mismatches = SUMMARY_KEYS
    .filter((key) => key !== 'sampleSize' && key !== 'seed')
    .filter((key) => key in jsReport && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  if ('corpus' in jsReport && JSON.stringify(python.corpus) !== JSON.stringify(js.corpus)) {
    mismatches.push({ key: 'corpus', python: python.corpus, js: js.corpus });
  }
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsRandomVerification({ fixture }) {
  return fixture.jsReport || {};
}

async function runPythonRandomVerification({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.random_verification', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonRandomVerificationComparison({ pythonReportPath, compareJsReportPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.random_verification_compare',
      '--python-report',
      pythonReportPath,
      '--compare-js-report',
      compareJsReportPath || jsReportPath,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, jsReport: fixture?.jsReport || {} };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'emoji-keyword-hit';
  const resolved = RANDOM_VERIFICATION_FIXTURES[name] || RANDOM_VERIFICATION_FIXTURES['emoji-keyword-hit'];
  return { name, payload: resolved.payload, jsReport: resolved.jsReport };
}

async function compareRandomVerificationSingle({
  payload,
  fixture,
  runJs = runJsRandomVerification,
  runPython = runPythonRandomVerification,
  runCompare = runPythonRandomVerificationComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'random-verification-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    const pythonReportPath = join(tempDir, 'python-report.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(resolved.jsReport || {}, null, 2), 'utf8');
    const context = {
      payload: resolved.payload,
      fixture: { name: resolved.name, jsReport: resolved.jsReport },
      payloadPath,
      jsReportPath,
      pythonReportPath,
    };
    const js = await runJs(context);
    const python = await runPython(context);
    await writeFile(pythonReportPath, JSON.stringify(python || {}, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({
      ...context,
      js,
      python,
      jsReport: js,
      pythonReport: python,
      compareJsReportPath: jsReportPath,
    });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareRandomVerification({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsRandomVerification,
  runPython = runPythonRandomVerification,
  runCompare = runPythonRandomVerificationComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareRandomVerificationSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareRandomVerificationSingle({ payload, fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareRandomVerification({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
