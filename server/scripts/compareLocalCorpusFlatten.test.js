import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOCAL_CORPUS_FLATTEN_FIXTURES, compareLocalCorpusFlatten, compareLocalCorpusFlattenObjects } from './compareLocalCorpusFlatten.js';

const COMMENTS = [
  {
    message: '本地语料评论',
    platform: 'bilibili',
    source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVflat/',
    uid: 'BVflat',
    uname: 'tester',
  },
];

test('compareLocalCorpusFlattenObjects reports matching flattened comment summaries', () => {
  const result = compareLocalCorpusFlattenObjects({ ok: true, count: 1, comments: COMMENTS }, { ok: true, count: 1, comments: COMMENTS });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { count: 1, comments: COMMENTS });
  assert.deepEqual(result.js, { count: 1, comments: COMMENTS });
});

test('compareLocalCorpusFlatten compares JS-compatible and Python flattened comments', async () => {
  const calls = [];
  const result = await compareLocalCorpusFlatten({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('local-flatten.json') });
      return { ok: true, count: 1, comments: COMMENTS };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('local-flatten.json') });
      return { ok: true, count: 1, comments: COMMENTS };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareLocalCorpusFlatten exports named local corpus shape fixtures', async () => {
  assert.deepEqual(Object.keys(LOCAL_CORPUS_FLATTEN_FIXTURES), [
    'uid-comment-map',
    'top-level-comments',
    'tieba-run-comments',
    'user-history-comments',
  ]);

  const calls = [];
  const result = await compareLocalCorpusFlatten({
    fixtureNames: Object.keys(LOCAL_CORPUS_FLATTEN_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('local-flatten.json') });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('local-flatten.json') });
      return context.fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'uid-comment-map', hasPayloadPath: true },
    { python: 'uid-comment-map', hasPayloadPath: true },
    { js: 'top-level-comments', hasPayloadPath: true },
    { python: 'top-level-comments', hasPayloadPath: true },
    { js: 'tieba-run-comments', hasPayloadPath: true },
    { python: 'tieba-run-comments', hasPayloadPath: true },
    { js: 'user-history-comments', hasPayloadPath: true },
    { python: 'user-history-comments', hasPayloadPath: true },
  ]);
});
