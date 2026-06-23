import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runDirectProbeCommand } from './probeBilibiliCommentEvidence.js';

const execFileAsync = promisify(execFile);

const SUMMARY_KEYS = ['actions', 'commentsCollected', 'commentMessages', 'scannedVideoKeys', 'entryTerms', 'warnings'];
const TERM = '\u67e5\u67e5\u8d44\u6599';
const QUERY = `${TERM} B\u7ad9\u8bc4\u8bba`;
const MESSAGE = '\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599\u518d\u8bc4\u8bba';
const EXPLICIT_AID_MESSAGE = `${TERM}\u663e\u5f0fAID\u547d\u4ee4`;
const EXPLICIT_DANMAKU_COMMENT = `${TERM}\u663e\u5f0f\u8bc4\u8bba`;
const EXPLICIT_DANMAKU_MESSAGE = `${TERM}\u663e\u5f0f\u5f39\u5e55`;
const WRITE_EXISTING_MESSAGE = '\u65e7\u8bc4\u8bba';
const WRITE_COMMENT_MESSAGE = `${TERM}\u5199\u5165\u8bc4\u8bba`;
const WRITE_DANMAKU_MESSAGE = `${TERM}\u5199\u5165\u5f39\u5e55`;

function dictionaryEntry(meaning) {
  return {
    term: TERM,
    family: 'evidence',
    meaning,
    evidenceCount: 0,
    evidenceSamples: [],
    evidenceSources: [],
  };
}

export const DEFAULT_PAYLOAD = {
  audit: { nextActions: [{ term: TERM, nextQuery: QUERY }] },
  existingCorpus: { version: 1, comments: [], runs: [] },
  dictionary: { entries: [dictionaryEntry('asks for sources')] },
  options: {
    maxActions: 1,
    videosPerQuery: 1,
    sourceVideosPerAction: 0,
    replyPages: 1,
    replyPageSize: 3,
    includeDanmaku: false,
    write: false,
    cookie: 'fixture-cookie',
    now: '2026-06-23T00:00:00.000Z',
  },
  searchVideos: {
    [QUERY]: [{ aid: '777', title: '\u67e5\u8d44\u6599 fixture' }],
  },
  videoComments: {
    'aid:777': [
      {
        message: MESSAGE,
        source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av777/',
        uid: '7',
      },
    ],
  },
};

export const DIRECT_PROBE_COMMAND_FIXTURES = {
  query: DEFAULT_PAYLOAD,
  'explicit-aid': {
    audit: { nextActions: [] },
    existingCorpus: { version: 1, comments: [], runs: [] },
    dictionary: { entries: [dictionaryEntry('explicit aid fixture')] },
    options: {
      maxActions: 1,
      videosPerQuery: 1,
      sourceVideosPerAction: 0,
      replyPages: 1,
      replyPageSize: 3,
      includeDanmaku: false,
      write: false,
      cookie: 'fixture-cookie',
      now: '2026-06-23T00:00:00.000Z',
    },
    explicitAids: ['999'],
    searchVideos: {},
    videoComments: {
      'aid:999': [
        {
          message: EXPLICIT_AID_MESSAGE,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av999/',
          uid: '9',
        },
      ],
    },
  },
  'explicit-aid-danmaku': {
    audit: { nextActions: [] },
    existingCorpus: { version: 1, comments: [], runs: [] },
    dictionary: { entries: [dictionaryEntry('explicit aid danmaku fixture')] },
    options: {
      maxActions: 1,
      videosPerQuery: 1,
      sourceVideosPerAction: 0,
      replyPages: 1,
      replyPageSize: 3,
      includeDanmaku: true,
      write: false,
      cookie: 'fixture-cookie',
      now: '2026-06-23T00:00:00.000Z',
    },
    explicitAids: ['1001'],
    searchVideos: {},
    videoComments: {
      'aid:1001': [
        {
          message: EXPLICIT_DANMAKU_COMMENT,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av1001/',
          uid: '10',
        },
      ],
    },
    videoDanmaku: {
      'aid:1001': [
        {
          message: EXPLICIT_DANMAKU_MESSAGE,
          source: 'Bilibili public danmaku probe: https://www.bilibili.com/video/av1001/',
          uid: '11',
        },
      ],
    },
  },
  'write-mode': {
    audit: { nextActions: [] },
    existingCorpus: {
      version: 1,
      comments: [{ message: WRITE_EXISTING_MESSAGE, source: 'old corpus fixture' }],
      runs: [],
    },
    dictionary: { entries: [dictionaryEntry('write-mode fixture')] },
    options: {
      maxActions: 1,
      videosPerQuery: 1,
      sourceVideosPerAction: 0,
      replyPages: 1,
      replyPageSize: 3,
      includeDanmaku: true,
      write: true,
      cookie: 'fixture-cookie',
      now: '2026-06-23T00:00:00.000Z',
    },
    explicitAids: ['1002'],
    searchVideos: {},
    videoComments: {
      'aid:1002': [
        {
          message: WRITE_COMMENT_MESSAGE,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av1002/',
          uid: '12',
        },
      ],
    },
    videoDanmaku: {
      'aid:1002': [
        {
          message: WRITE_DANMAKU_MESSAGE,
          source: 'Bilibili public danmaku probe: https://www.bilibili.com/video/av1002/',
          uid: '13',
        },
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['query', 'explicit-aid', 'explicit-aid-danmaku', 'write-mode'];

function resolvePayload({ fixture = 'query', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'query');
  return { name, payload: DIRECT_PROBE_COMMAND_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  if (
    Array.isArray(result.actions)
    && Array.isArray(result.commentMessages)
    && Array.isArray(result.scannedVideoKeys)
    && Array.isArray(result.entryTerms)
  ) {
    return {
      actions: result.actions.map((action) => ({ term: action?.term, query: action?.query })),
      commentsCollected: Number(result.commentsCollected || 0),
      commentMessages: result.commentMessages,
      scannedVideoKeys: result.scannedVideoKeys,
      entryTerms: result.entryTerms,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  }
  const actions = Array.isArray(result.actions) ? result.actions : [];
  const comments = Array.isArray(result.comments) ? result.comments : [];
  const scannedVideos = Array.isArray(result.scannedVideos) ? result.scannedVideos : [];
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return {
    actions: actions.map((action) => ({ term: action?.term, query: action?.query })),
    commentsCollected: Number(result.commentsCollected || 0),
    commentMessages: comments.map((comment) => comment?.message).filter(Boolean),
    scannedVideoKeys: scannedVideos.map((video) => video?.key).filter(Boolean),
    entryTerms: entries.map((entry) => entry?.term).filter(Boolean),
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export function compareDirectProbeCommandObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runPythonDirectProbeCommand({ payload, payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.direct_probe_command', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runJsDirectProbeCommand({ payload }) {
  const action = payload.audit?.nextActions?.[0] || {};
  const term = action.term || TERM;
  const query = action.nextQuery || action.query || term;
  const explicitAids = Array.isArray(payload.explicitAids)
    ? payload.explicitAids.map((aid) => String(aid || '').trim()).filter(Boolean)
    : [];
  const includeDanmaku = payload.options?.includeDanmaku === true;
  const write = payload.options?.write === true;
  const argv = explicitAids.length
    ? [
      ...explicitAids.map((aid) => `--aid=${aid}`),
      ...(includeDanmaku ? ['--include-danmaku'] : []),
      ...(write ? ['--write'] : []),
      '--delay-ms=1000',
      '--jitter-ms=0',
    ]
    : [`--query=${query}`, `--term=${term}`, ...(includeDanmaku ? ['--include-danmaku'] : []), ...(write ? ['--write'] : []), '--delay-ms=1000', '--jitter-ms=0'];
  const searchVideos = payload.searchVideos || {};
  const videoComments = payload.videoComments || {};
  const videoDanmaku = payload.videoDanmaku || {};
  return runDirectProbeCommand({
    argv,
    env: {},
    readJson: async () => payload.audit || { nextActions: [] },
    readJsonCorpus: async () => payload.existingCorpus || { version: 1, comments: [], runs: [] },
    readKeywordDictionary: async () => payload.dictionary || { entries: [] },
    discoverVideos: async (requestedQuery) => searchVideos[requestedQuery] || [],
    fetchVideoComments: async (video) => videoComments[video.bvid ? `bvid:${video.bvid}` : `aid:${video.aid}`] || [],
    fetchVideoDanmaku: async (video) => videoDanmaku[video.bvid ? `bvid:${video.bvid}` : `aid:${video.aid}`] || [],
    writeJsonCorpus: async () => {},
    mergeEntriesIntoDictionary: async (entries) => ({ entries }),
    log: () => {},
    now: () => payload.options?.now || '2026-06-23T00:00:00.000Z',
    makeCookie: () => payload.options?.cookie || 'fixture-cookie',
  });
}

export async function compareDirectProbeCommand({
  fixture = 'query',
  payload,
  runJs = runJsDirectProbeCommand,
  runPython = runPythonDirectProbeCommand,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-command-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareDirectProbeCommandObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareDirectProbeCommandSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareDirectProbeCommand({ fixture }));
  }
  return {
    ok: results.every((result) => result.ok),
    fixtures: results.map((result) => ({
      name: result.fixture.name,
      ok: result.ok,
      js: result.js,
      python: result.python,
      mismatches: result.mismatches,
    })),
  };
}

async function main() {
  const result = await compareDirectProbeCommandSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
