import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareLocalCorpusFlatten, compareLocalCorpusFlattenObjects } from './compareLocalCorpusFlatten.js';

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
