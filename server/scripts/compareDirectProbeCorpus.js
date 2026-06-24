import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runDirectProbeCommand } from './probeBilibiliCommentEvidence.js';

const execFileAsync = promisify(execFile);

const OLD_COMMENT = '\u65e7\u8bc4\u8bba';
const NEW_COMMENT = '\u65b0\u5f39\u5e55\u8bc4\u8bba';

export const DEFAULT_PAYLOAD = {
  existing: {
    version: 1,
    comments: [{ message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' }],
    runs: [],
  },
  comments: [
    {
      message: NEW_COMMENT,
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1fixture',
      uid: '2',
    },
    { message: 'ascii only skip', source: 'Bilibili direct probe fixture', uid: '3' },
    { message: OLD_COMMENT, source: 'duplicate fixture', uid: '1' },
  ],
  run: {
    at: '2026-06-23T00:00:00.000Z',
    query: '\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba',
    videos: [{ key: 'bvid:BV1fixture', bvid: 'BV1fixture' }],
  },
};

export const DEFAULT_JS_REPORT = {
  ok: true,
  corpus: {
    version: 1,
    comments: [
      { message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' },
      {
        message: NEW_COMMENT,
        source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1fixture',
        uid: '2',
      },
    ],
    runs: [
      {
        at: '2026-06-23T00:00:00.000Z',
        query: '\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba',
        videos: [{ key: 'bvid:BV1fixture', bvid: 'BV1fixture' }],
        commentsCollected: 3,
        commentsAdded: 1,
      },
    ],
    updatedAt: '2026-06-23T00:00:00.000Z',
  },
};

const EMPTY_EXISTING_COMMENT = '\u5168\u65b0\u8bc4\u8bba';
const MULTI_VIDEO_COMMENT_ONE = '\u591a\u89c6\u9891\u8bc4\u8bba\u4e00';
const MULTI_VIDEO_COMMENT_TWO = '\u591a\u89c6\u9891\u8bc4\u8bba\u4e8c';

export const DIRECT_PROBE_CORPUS_FIXTURES = {
  'dedupe-han-comment': {
    payload: DEFAULT_PAYLOAD,
    expectedJsReport: DEFAULT_JS_REPORT,
  },
  'empty-existing-corpus': {
    payload: {
      existing: { version: 1, comments: [], runs: [] },
      comments: [
        {
          message: EMPTY_EXISTING_COMMENT,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVempty',
          uid: '10',
        },
        { message: 'ascii only skip', source: 'Bilibili direct probe fixture', uid: '11' },
      ],
      run: {
        at: '2026-06-23T01:00:00.000Z',
        query: '\u7a7a\u5e93 B\u7ad9\u8bc4\u8bba',
        videos: [{ key: 'bvid:BVempty', bvid: 'BVempty' }],
      },
    },
    expectedJsReport: {
      ok: true,
      corpus: {
        version: 1,
        comments: [
          {
            message: EMPTY_EXISTING_COMMENT,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVempty',
            uid: '10',
          },
        ],
        runs: [
          {
            at: '2026-06-23T01:00:00.000Z',
            query: '\u7a7a\u5e93 B\u7ad9\u8bc4\u8bba',
            videos: [{ key: 'bvid:BVempty', bvid: 'BVempty' }],
            commentsCollected: 2,
            commentsAdded: 1,
          },
        ],
        updatedAt: '2026-06-23T01:00:00.000Z',
      },
    },
  },
  'multi-video-run': {
    payload: {
      existing: {
        version: 1,
        comments: [{ message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' }],
        runs: [
          {
            at: '2026-06-22T00:00:00.000Z',
            query: '\u65e7\u8fd0\u884c',
            videos: [],
            commentsCollected: 0,
            commentsAdded: 0,
          },
        ],
      },
      comments: [
        {
          message: MULTI_VIDEO_COMMENT_ONE,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVmulti1',
          uid: '20',
        },
        {
          message: MULTI_VIDEO_COMMENT_TWO,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVmulti2',
          uid: '21',
        },
        { message: MULTI_VIDEO_COMMENT_ONE, source: 'duplicate fixture', uid: '20' },
      ],
      run: {
        at: '2026-06-23T02:00:00.000Z',
        query: '\u591a\u89c6\u9891 B\u7ad9\u8bc4\u8bba',
        videos: [
          { key: 'bvid:BVmulti1', bvid: 'BVmulti1' },
          { key: 'bvid:BVmulti2', bvid: 'BVmulti2' },
        ],
      },
    },
    expectedJsReport: {
      ok: true,
      corpus: {
        version: 1,
        comments: [
          { message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' },
          {
            message: MULTI_VIDEO_COMMENT_ONE,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVmulti1',
            uid: '20',
          },
          {
            message: MULTI_VIDEO_COMMENT_TWO,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVmulti2',
            uid: '21',
          },
        ],
        runs: [
          {
            at: '2026-06-22T00:00:00.000Z',
            query: '\u65e7\u8fd0\u884c',
            videos: [],
            commentsCollected: 0,
            commentsAdded: 0,
          },
          {
            at: '2026-06-23T02:00:00.000Z',
            query: '\u591a\u89c6\u9891 B\u7ad9\u8bc4\u8bba',
            videos: [
              { key: 'bvid:BVmulti1', bvid: 'BVmulti1' },
              { key: 'bvid:BVmulti2', bvid: 'BVmulti2' },
            ],
            commentsCollected: 3,
            commentsAdded: 2,
          },
        ],
        updatedAt: '2026-06-23T02:00:00.000Z',
      },
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(DIRECT_PROBE_CORPUS_FIXTURES);

async function runPythonDirectProbeCorpus({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.direct_probe_corpus', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runJsDirectProbeCorpus({ payload }) {
  const query = payload.run?.query || '\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba';
  const term = query.split(/\s+/)[0] || '\u67e5\u67e5\u8d44\u6599';
  const captured = { corpus: null };
  const videos = Array.isArray(payload.run?.videos) ? payload.run.videos : [];
  const result = await runDirectProbeCommand({
    argv: [`--query=${query}`, `--term=${term}`, '--write', '--delay-ms=1000', '--jitter-ms=0'],
    env: {},
    readJson: async () => ({ nextActions: [] }),
    readJsonCorpus: async () => payload.existing || { version: 1, comments: [], runs: [] },
    readKeywordDictionary: async () => ({
      entries: [
        {
          term,
          family: 'evidence',
          meaning: 'direct probe fixture term',
          evidenceCount: 0,
          evidenceSamples: [],
          evidenceSources: [],
        },
      ],
    }),
    discoverVideos: async () => videos,
    fetchVideoComments: async () => payload.comments || [],
    fetchVideoDanmaku: async () => [],
    writeJsonCorpus: async (_path, corpus) => {
      captured.corpus = corpus;
    },
    mergeEntriesIntoDictionary: async (entries) => ({ entries }),
    log: () => {},
    now: () => payload.run?.at || '2026-06-23T00:00:00.000Z',
    makeCookie: () => 'fixture-cookie',
  });
  return { ok: result.ok, corpus: captured.corpus || result.corpus };
}

export async function compareDirectProbeCorpus({
  payload,
  fixture,
  fixtureNames,
  jsReport = null,
  runJs = runJsDirectProbeCorpus,
  runPython = runPythonDirectProbeCorpus,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareDirectProbeCorpus({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? DIRECT_PROBE_CORPUS_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-corpus-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    const actualJsReport = jsReport || await runJs({
      payload: resolvedPayload,
      fixture: { name: resolvedName, expectedJsReport: resolvedFixture?.expectedJsReport },
    });
    const jsRuns = Array.isArray(actualJsReport?.corpus?.runs) ? actualJsReport.corpus.runs : [];
    const comparisonPayload = { ...resolvedPayload, run: jsRuns[jsRuns.length - 1] || resolvedPayload.run };
    await writeFile(payloadPath, JSON.stringify(comparisonPayload, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(actualJsReport, null, 2), 'utf8');

    const comparison = await runPython({
      payload: comparisonPayload,
      jsReport: actualJsReport,
      payloadPath,
      jsReportPath,
      fixture: { name: resolvedName, expectedJsReport: resolvedFixture?.expectedJsReport },
    });
    return {
      ok: Boolean(comparison.ok),
      fixture: { name: resolvedName, payloadPath, jsReportPath },
      js: comparison.js,
      python: comparison.python,
      mismatches: Array.isArray(comparison.mismatches) ? comparison.mismatches : [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDirectProbeCorpus({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
