import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDirectProbeCommand, compareDirectProbeCommandObjects, compareDirectProbeCommandSuite } from './compareDirectProbeCommand.js';

const TERM = '\u67e5\u67e5\u8d44\u6599';
const QUERY = `${TERM} B\u7ad9\u8bc4\u8bba`;
const MESSAGE = '\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599\u518d\u8bc4\u8bba';

const COMMAND_SUMMARY = {
  actions: [{ term: TERM, query: QUERY }],
  commentsCollected: 1,
  commentMessages: [MESSAGE],
  scannedVideoKeys: ['aid:777'],
  entryTerms: [TERM],
  warnings: [],
};

test('compareDirectProbeCommandObjects compares JS and Python command summaries', () => {
  const result = compareDirectProbeCommandObjects(
    { ok: true, ignored: true, ...COMMAND_SUMMARY },
    { ok: true, ignored: false, ...COMMAND_SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, COMMAND_SUMMARY);
  assert.deepEqual(result.js, COMMAND_SUMMARY);
});

test('compareDirectProbeCommand runs injected JS and Python command runners', async () => {
  const calls = [];
  const result = await compareDirectProbeCommand({
    runJs: async ({ payload }) => {
      calls.push({ runner: 'js', query: payload.audit.nextActions[0].nextQuery });
      return { ok: true, ...COMMAND_SUMMARY };
    },
    runPython: async ({ payload }) => {
      calls.push({ runner: 'python', videos: payload.searchVideos[QUERY].length });
      return { ok: true, ...COMMAND_SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { runner: 'js', query: QUERY },
    { runner: 'python', videos: 1 },
  ]);
});

test('compareDirectProbeCommand compares explicit AID command input', async () => {
  const explicitMessage = `${TERM}\u663e\u5f0fAID\u547d\u4ee4`;
  const result = await compareDirectProbeCommand({
    payload: {
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: {
        entries: [
          {
            term: TERM,
            family: 'evidence',
            meaning: 'explicit aid fixture',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
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
            message: explicitMessage,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av999/',
            uid: '9',
          },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.comments.map((comment) => comment.message), [explicitMessage]);
  assert.deepEqual(result.js.comments.map((comment) => comment.message), [explicitMessage]);
  assert.deepEqual(result.python.scannedVideos.map((video) => video.key), ['aid:999']);
  assert.deepEqual(result.js.scannedVideos.map((video) => video.key), ['aid:999']);
});

test('compareDirectProbeCommand compares explicit AID danmaku command input', async () => {
  const explicitMessage = `${TERM}\u663e\u5f0f\u8bc4\u8bba`;
  const danmakuMessage = `${TERM}\u663e\u5f0f\u5f39\u5e55`;
  const result = await compareDirectProbeCommand({
    payload: {
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: {
        entries: [
          {
            term: TERM,
            family: 'evidence',
            meaning: 'explicit aid danmaku fixture',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
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
            message: explicitMessage,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av1001/',
            uid: '10',
          },
        ],
      },
      videoDanmaku: {
        'aid:1001': [
          {
            message: danmakuMessage,
            source: 'Bilibili public danmaku probe: https://www.bilibili.com/video/av1001/',
            uid: '11',
          },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.comments.map((comment) => comment.message), [explicitMessage, danmakuMessage]);
  assert.deepEqual(result.js.comments.map((comment) => comment.message), [explicitMessage, danmakuMessage]);
});

test('compareDirectProbeCommand compares source video recovery input', async () => {
  const result = await compareDirectProbeCommand({ fixture: 'source-video' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.scannedVideos.map((video) => video.key), ['bvid:BVsourceProbe1']);
  assert.deepEqual(result.js.scannedVideos.map((video) => video.key), ['bvid:BVsourceProbe1']);
  assert.deepEqual(result.python.comments.map((comment) => comment.message), [`${TERM}来源视频新评论`]);
  assert.deepEqual(result.js.comments.map((comment) => comment.message), [`${TERM}来源视频新评论`]);
});

test('compareDirectProbeCommand compares write-mode corpus output', async () => {
  const existingMessage = '\u65e7\u8bc4\u8bba';
  const explicitMessage = `${TERM}\u5199\u5165\u8bc4\u8bba`;
  const danmakuMessage = `${TERM}\u5199\u5165\u5f39\u5e55`;
  const result = await compareDirectProbeCommand({
    payload: {
      audit: { nextActions: [] },
      existingCorpus: {
        version: 1,
        comments: [{ message: existingMessage, source: 'old corpus fixture' }],
        runs: [],
      },
      dictionary: {
        entries: [
          {
            term: TERM,
            family: 'evidence',
            meaning: 'write-mode fixture',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
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
            message: explicitMessage,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av1002/',
            uid: '12',
          },
        ],
      },
      videoDanmaku: {
        'aid:1002': [
          {
            message: danmakuMessage,
            source: 'Bilibili public danmaku probe: https://www.bilibili.com/video/av1002/',
            uid: '13',
          },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.write, true);
  assert.equal(result.js.write, true);
  assert.deepEqual(result.python.corpus.comments.map((comment) => comment.message), [
    existingMessage,
    explicitMessage,
    danmakuMessage,
  ]);
  assert.deepEqual(result.js.corpus.comments.map((comment) => comment.message), [
    existingMessage,
    explicitMessage,
    danmakuMessage,
  ]);
  assert.equal(result.python.corpus.runs.length, 1);
  assert.equal(result.js.corpus.runs.length, 1);
});

test('compareDirectProbeCommand compares Python full-runtime fixture transport', async () => {
  const fullRuntimeMessage = `${TERM}\u5168\u91cfPython\u8bc4\u8bba`;
  const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?${new URLSearchParams({
    search_type: 'video',
    keyword: QUERY,
    page: '1',
    page_size: '20',
  }).toString()}`;
  const replyUrl = 'https://api.bilibili.com/x/v2/reply/main?type=1&oid=778&mode=3&next=0&ps=3';
  const result = await compareDirectProbeCommand({
    payload: {
      audit: { nextActions: [{ term: TERM, nextQuery: QUERY }] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: {
        entries: [
          {
            term: TERM,
            family: 'evidence',
            meaning: 'full runtime fixture',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
      options: {
        maxActions: 1,
        videosPerQuery: 1,
        searchPages: 1,
        sourceVideosPerAction: 0,
        replyPages: 1,
        replyPageSize: 3,
        usePythonLiveSearch: true,
        usePythonLiveFetch: true,
        write: false,
        cookie: 'fixture-cookie',
        now: '2026-06-23T00:00:00.000Z',
      },
      searchJsonResponses: {
        [searchUrl]: {
          data: {
            result: [{ bvid: 'BVfull', aid: 778, title: '\u5168\u91cfPython fixture', review: 3 }],
          },
        },
      },
      liveFetchJsonResponses: {
        [replyUrl]: {
          data: {
            cursor: { is_end: true },
            replies: [{ mid: 78, content: { message: fullRuntimeMessage } }],
          },
        },
      },
    },
    runJs: async ({ payload }) => ({
      ok: true,
      actions: [{ term: TERM, query: QUERY }],
      commentsCollected: 1,
      comments: [
        {
          message: fullRuntimeMessage,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVfull/',
          uid: '78',
        },
      ],
      scannedVideos: [{ key: 'bvid:BVfull' }],
      warnings: [],
      entries: [{ term: TERM }],
      payloadObserved: payload.options.usePythonLiveSearch,
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.comments.map((comment) => comment.message), [fullRuntimeMessage]);
  assert.deepEqual(result.python.scannedVideos.map((video) => video.key), ['bvid:BVfull']);
});

test('compareDirectProbeCommandSuite runs default command fixtures', async () => {
  const result = await compareDirectProbeCommandSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['query', 'explicit-aid', 'explicit-aid-danmaku', 'source-video', 'write-mode']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.deepEqual(result.fixtures.find((fixture) => fixture.name === 'explicit-aid').python.scannedVideos.map((video) => video.key), ['aid:999']);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'write-mode').python.write, true);
});
