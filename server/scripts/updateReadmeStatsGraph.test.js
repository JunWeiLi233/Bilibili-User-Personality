import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCollectionTimeline, paddedTimelineMax } from './updateReadmeStatsGraph.js';

test('buildCollectionTimeline accumulates comment and danmaku growth by run time', () => {
  const timeline = buildCollectionTimeline([
    {
      name: 'direct',
      runs: [
        { at: '2026-06-17T10:00:00.000Z', commentsAdded: 3 },
        { at: '2026-06-17T11:00:00.000Z', commentsAdded: 2 },
      ],
      comments: [
        { message: '评论一', source: 'Bilibili public direct comment probe' },
        { message: '弹幕一', source: 'Bilibili public direct danmaku probe' },
        { message: '弹幕二', source: 'Bilibili public direct danmaku probe' },
        { message: '评论二', source: 'Bilibili public direct comment probe' },
        { message: '评论三', source: 'Bilibili public direct comment probe' },
      ],
    },
    {
      name: 'external',
      runs: [
        { at: '2026-06-17T12:00:00.000Z', addedComments: 2 },
      ],
      comments: [
        { message: '数据一', source: 'Kaggle dataset' },
        { message: '数据二', source: 'Kaggle dataset' },
      ],
    },
  ]);

  assert.deepEqual(timeline.points.map(({ date }) => date), [
    '2026-06-17T10:00:00.000Z',
    '2026-06-17T11:00:00.000Z',
    '2026-06-17T12:00:00.000Z',
  ]);
  assert.deepEqual(timeline.points.map(({ comments, danmaku }) => [comments, danmaku]), [
    [2, 1],
    [3, 2],
    [5, 2],
  ]);
  assert.equal(timeline.finalComments, 5);
  assert.equal(timeline.finalDanmaku, 2);
});

test('paddedTimelineMax keeps the highest timeline point below the top grid line', () => {
  assert.equal(paddedTimelineMax(179185), 200000);
  assert.ok(paddedTimelineMax(179185) > 179185);
});
