import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDEO_RELEVANCE_FIXTURES,
  compareVideoRelevance,
  compareVideoRelevanceObjects,
} from './compareVideoRelevance.js';

test('compareVideoRelevanceObjects reports matching normalized relevance summaries', () => {
  const report = {
    ok: true,
    operation: 'filter',
    needles: ['宝宝'],
    videos: [{ bvid: 'BV1', title: '宝宝评论区' }],
    ignored: true,
  };

  assert.deepEqual(compareVideoRelevanceObjects(report, report), {
    ok: true,
    mismatches: [],
    python: { operation: 'filter', needles: ['宝宝'], videos: ['BV1'] },
    js: { operation: 'filter', needles: ['宝宝'], videos: ['BV1'] },
  });
});

test('compareVideoRelevance compares JS and Python filtered video relevance', async () => {
  const result = await compareVideoRelevance({
    payload: {
      operation: 'filter',
      videos: [
        { bvid: 'BV1', title: 'AI 争议 评论区 很热' },
        { bvid: 'BV2', title: '评论区 很热' },
      ],
      searchQueries: ['AI争议 评论区'],
      targetExistingTerms: [],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.videos.map((video) => video.bvid), ['BV1']);
});

test('compareVideoRelevance exports offline relevance fixtures', async () => {
  assert.deepEqual(Object.keys(VIDEO_RELEVANCE_FIXTURES), [
    'alias-sort',
    'ask-baidu-filter',
    'strict-target-filter',
  ]);

  const result = await compareVideoRelevance({
    fixtureNames: Object.keys(VIDEO_RELEVANCE_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareVideoRelevance real runners preserve offline relevance contracts', async () => {
  const result = await compareVideoRelevance({
    fixtureNames: Object.keys(VIDEO_RELEVANCE_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
