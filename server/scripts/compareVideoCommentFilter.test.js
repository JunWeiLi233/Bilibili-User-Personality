import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDEO_COMMENT_FILTER_FIXTURES,
  compareVideoCommentFilter,
  compareVideoCommentFilterObjects,
} from './compareVideoCommentFilter.js';

test('compareVideoCommentFilterObjects reports matching normalized comment summaries', () => {
  const report = {
    ok: true,
    applied: true,
    matched: 1,
    before: 2,
    after: 1,
    needleCount: 1,
    comments: [{ rpid: '1', message: '网盘见' }],
    ignored: true,
  };

  assert.deepEqual(compareVideoCommentFilterObjects(report, report), {
    ok: true,
    mismatches: [],
    python: { applied: true, matched: 1, before: 2, after: 1, needleCount: 1, comments: ['1'] },
    js: { applied: true, matched: 1, before: 2, after: 1, needleCount: 1, comments: ['1'] },
  });
});

test('compareVideoCommentFilter compares JS and Python needle filtering', async () => {
  const result = await compareVideoCommentFilter({
    payload: {
      comments: [
        { rpid: '1', message: '哈哈哈 网 盘 见！' },
        { rpid: '2', message: '完全无关' },
        { rpid: '3', message: '这就是中国宝宝体质了' },
      ],
      needles: ['网盘见'],
      extraNeedles: ['中国宝宝体质'],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python.comments.map((comment) => comment.rpid), ['1', '3']);
});

test('compareVideoCommentFilter exports offline comment filter fixtures', async () => {
  assert.deepEqual(Object.keys(VIDEO_COMMENT_FILTER_FIXTURES), [
    'needle-filter',
    'dictionary-prefilter',
    'fallback-empty-match',
  ]);

  const result = await compareVideoCommentFilter({
    fixtureNames: Object.keys(VIDEO_COMMENT_FILTER_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareVideoCommentFilter real runners preserve offline comment filter contracts', async () => {
  const result = await compareVideoCommentFilter({
    fixtureNames: Object.keys(VIDEO_COMMENT_FILTER_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
