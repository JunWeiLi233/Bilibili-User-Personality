import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDEO_CONTEXT_FIXTURES,
  compareVideoContext,
  compareVideoContextObjects,
} from './compareVideoContext.js';

test('compareVideoContextObjects reports matching context summaries', () => {
  const report = {
    ok: true,
    videoContextText: 'Bilibili video context: 中国宝宝体质 名场面',
    videoObjectEvidenceText: 'Bilibili public video title: 中国宝宝体质 名场面',
    contextSourceUrls: ['https://www.bilibili.com/video/BV1'],
    diagnostics: { scannedVideos: 1, commentsCollected: 1 },
    ignored: true,
  };

  assert.deepEqual(compareVideoContextObjects(report, report), {
    ok: true,
    mismatches: [],
    python: {
      videoContextText: 'Bilibili video context: 中国宝宝体质 名场面',
      videoObjectEvidenceText: 'Bilibili public video title: 中国宝宝体质 名场面',
      contextSourceUrls: ['https://www.bilibili.com/video/BV1'],
      diagnostics: { scannedVideos: 1, commentsCollected: 1 },
    },
    js: {
      videoContextText: 'Bilibili video context: 中国宝宝体质 名场面',
      videoObjectEvidenceText: 'Bilibili public video title: 中国宝宝体质 名场面',
      contextSourceUrls: ['https://www.bilibili.com/video/BV1'],
      diagnostics: { scannedVideos: 1, commentsCollected: 1 },
    },
  });
});

test('compareVideoContext compares JS and Python context text and diagnostics', async () => {
  const result = await compareVideoContext({
    payload: {
      videos: [
        {
          bvid: 'BV1',
          title: '中国宝宝体质 名场面',
          desc: '评论区   复盘',
          sourceUrl: 'https://www.bilibili.com/video/BV1',
        },
      ],
      discoveredVideos: [{ bvid: 'BVD', title: '发现素材' }],
      comments: [{ message: '中国宝宝体质' }],
      trainingText: '中国宝宝体质 中国宝宝体质 路过',
      searchQueries: ['中国宝宝体质 评论区'],
      targetExistingTerms: ['中国宝宝体质', '路过'],
      keywordTraining: {
        entries: [{ term: '中国宝宝体质' }],
        dictionaryEvidenceEntries: [{ term: '路过' }],
        evidenceRejected: '2',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.diagnostics.commentsCollected, 1);
  assert.deepEqual(result.python.diagnostics.targetTextHits, [
    { term: '中国宝宝体质', count: 2 },
    { term: '路过', count: 1 },
  ]);
});

test('compareVideoContext exports offline context fixtures', async () => {
  assert.deepEqual(Object.keys(VIDEO_CONTEXT_FIXTURES), [
    'context-and-evidence',
    'diagnostics-only',
    'discovery-context-dedupe',
  ]);

  const result = await compareVideoContext({
    fixtureNames: Object.keys(VIDEO_CONTEXT_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareVideoContext real runners preserve offline context contracts', async () => {
  const result = await compareVideoContext({
    fixtureNames: Object.keys(VIDEO_CONTEXT_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
