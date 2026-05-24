import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReplyForUid, dedupePublicObjects, extractDynamicRecords, parseBvidPool } from './bilibiliCrawler.js';

test('parseBvidPool accepts whitespace, comma, and Chinese comma separators', () => {
  assert.deepEqual(parseBvidPool('BV19yGa61Ee6, BV1xx411c7mD，BVabc1234567  bad-id'), [
    'BV19yGa61Ee6',
    'BV1xx411c7mD',
    'BVabc1234567',
  ]);
});

test('extractDynamicRecords returns commentable dynamic objects and authored text', () => {
  const records = extractDynamicRecords(
    [
      {
        id_str: '111222333',
        basic: {
          comment_type: 17,
          comment_id_str: '998877',
        },
        modules: {
          module_dynamic: {
            desc: {
              text: '这个观点你先别急着扣帽子，证据链还没给全。',
            },
          },
        },
        type: 'DYNAMIC_TYPE_WORD',
      },
    ],
    '453244911',
  );

  assert.equal(records.objects.length, 1);
  assert.deepEqual(records.objects[0], {
    id: 'dynamic-17-998877',
    kind: 'dynamic',
    oid: '998877',
    replyType: 17,
    title: '动态：这个观点你先别急着扣帽子，证据链还没给全。',
    authorMid: '453244911',
    sourceUrl: 'https://t.bilibili.com/111222333',
    replyCount: 0,
  });
  assert.equal(records.authoredPosts.length, 1);
  assert.equal(records.authoredPosts[0].message, '这个观点你先别急着扣帽子，证据链还没给全。');
});

test('collectReplyForUid captures nested replies by target UID with source metadata', () => {
  const bucket = [];
  collectReplyForUid(
    {
      rpid: 1,
      mid: 100,
      member: { mid: '100', uname: 'other' },
      content: { message: 'root' },
      replies: [
        {
          rpid: 2,
          mid: 453244911,
          member: { mid: '453244911', uname: 'target' },
          content: { message: '你这个结论少了关键前提。' },
          like: 6,
          ctime: 1710000000,
        },
      ],
    },
    '453244911',
    {
      kind: 'video',
      bvid: 'BV19yGa61Ee6',
      oid: 123,
      replyType: 1,
      title: '测试视频',
      sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
    },
    bucket,
  );

  assert.equal(bucket.length, 1);
  assert.deepEqual(bucket[0], {
    sourceKind: 'video',
    bvid: 'BV19yGa61Ee6',
    oid: '123',
    replyType: 1,
    sourceTitle: '测试视频',
    sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
    rpid: '2',
    like: 6,
    ctime: 1710000000,
    uname: 'target',
    mid: '453244911',
    message: '你这个结论少了关键前提。',
  });
});

test('dedupePublicObjects keeps unique reply targets across discovery sources', () => {
  const objects = dedupePublicObjects([
    { kind: 'video', oid: 123, replyType: 1, title: 'A' },
    { kind: 'video', oid: '123', replyType: 1, title: 'A duplicate' },
    { kind: 'dynamic', oid: '123', replyType: 17, title: 'different comment target' },
  ]);

  assert.equal(objects.length, 2);
  assert.equal(objects[0].title, 'A');
  assert.equal(objects[1].kind, 'dynamic');
});
