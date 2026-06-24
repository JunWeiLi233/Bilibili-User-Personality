import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { sampleCommentCoverage } from '../services/commentCoverage.js';

const execFileAsync = promisify(execFile);

const SUMMARY_KEYS = ['total', 'covered', 'uncovered', 'coverageRatio'];
const MODE_KEYS = ['keyword', 'neutral', 'uncovered'];

export const COMMENT_COVERAGE_FIXTURES = {
  'keyword-neutral-uncovered': {
    payload: {
      dictionary: {
        entries: [
          {
            term: '\u61c2\u7684\u90fd\u61c2',
            family: 'evasion',
            meaning: 'implicit evasion cue',
          },
        ],
      },
      comments: [
        { message: '\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2' },
        { message: '\u666e\u901a\u8bc4\u8bba' },
        { message: 'plain ascii' },
        { message: '!!!' },
      ],
    },
    expected: {
      ok: true,
      summary: {
        total: 4,
        covered: 3,
        uncovered: 1,
        coverageRatio: 0.75,
        byMode: { keyword: 1, neutral: 2, uncovered: 1 },
      },
    },
  },
  'sample-size-limit': {
    payload: {
      sampleSize: 2,
      dictionary: { entries: [{ term: '\u61c2\u7684\u90fd\u61c2', family: 'evasion' }] },
      comments: [
        { message: '\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2' },
        { message: 'plain ascii' },
        { message: '\u672a\u91c7\u6837\u7684\u4e2d\u6587\u8bc4\u8bba' },
      ],
    },
    expected: {
      ok: true,
      summary: {
        total: 2,
        covered: 1,
        uncovered: 1,
        coverageRatio: 0.5,
        byMode: { keyword: 1, neutral: 0, uncovered: 1 },
      },
    },
  },
  'scrape-diagnostic-neutral': {
    payload: {
      dictionary: { entries: [] },
      comments: [
        { message: 'discover history: HTTP 403 from https://api.bilibili.com/x/web-interface/search/type' },
        { message: '\u5f88\u666e\u901a\u7684\u8bc4\u8bba' },
      ],
    },
    expected: {
      ok: true,
      summary: {
        total: 2,
        covered: 2,
        uncovered: 0,
        coverageRatio: 1,
        byMode: { keyword: 0, neutral: 2, uncovered: 0 },
      },
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(COMMENT_COVERAGE_FIXTURES);

function summarize(result = {}) {
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : result;
  const byMode = summary.byMode && typeof summary.byMode === 'object' ? summary.byMode : {};
  return {
    ...Object.fromEntries(SUMMARY_KEYS.map((key) => [key, summary[key]])),
    byMode: Object.fromEntries(MODE_KEYS.map((key) => [key, byMode[key]])),
  };
}

export function compareCommentCoverageObjects(pythonResult = {}, jsResult = {}) {
  const pythonSummary = summarize(pythonResult);
  const jsSummary = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => pythonSummary[key] !== jsSummary[key]).map((key) => ({
    key,
    python: pythonSummary[key],
    js: jsSummary[key],
  }));
  mismatches.push(
    ...MODE_KEYS.filter((key) => pythonSummary.byMode[key] !== jsSummary.byMode[key]).map((key) => ({
      key: `byMode.${key}`,
      python: pythonSummary.byMode[key],
      js: jsSummary.byMode[key],
    })),
  );
  return {
    ok: mismatches.length === 0,
    mismatches,
    python: { summary: pythonSummary },
    js: { summary: jsSummary },
  };
}

async function runJsCommentCoverage({ payload }) {
  const comments = (Array.isArray(payload.comments) ? payload.comments : []).map((comment) => (
    comment && typeof comment === 'object'
      ? comment.message ?? comment.content ?? comment.text ?? ''
      : comment
  ));
  return {
    ok: true,
    summary: sampleCommentCoverage(
      payload.dictionary || { entries: [] },
      comments,
      payload.sampleSize == null ? {} : { sampleSize: payload.sampleSize },
    ),
  };
}

async function runPythonCommentCoverage({ payloadPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.comment_coverage', '--payload', payloadPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareCommentCoverage({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsCommentCoverage,
  runPython = runPythonCommentCoverage,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareCommentCoverage({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? COMMENT_COVERAGE_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'keyword-neutral-uncovered';
  const resolvedPayload = payload || resolvedFixture?.payload || COMMENT_COVERAGE_FIXTURES['keyword-neutral-uncovered'].payload;
  const tempDir = await mkdtemp(join(tmpdir(), 'comment-coverage-compare-'));
  try {
    const payloadPath = join(tempDir, 'comment-coverage.json');
    await writeFile(payloadPath, JSON.stringify(resolvedPayload, null, 2), 'utf8');
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareCommentCoverageObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareCommentCoverage({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
