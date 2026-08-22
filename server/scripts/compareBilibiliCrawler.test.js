import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BILIBILI_CRAWLER_FIXTURES,
  compareBilibiliCrawler,
  compareBilibiliCrawlerObjects,
} from './compareBilibiliCrawler.js';

test('compareBilibiliCrawlerObjects reports matching crawler helper summaries', () => {
  const report = {
    ok: true,
    bvids: ['BV19yGa61Ee6'],
    bvid: 'BV19yGa61Ee6',
    blocked: true,
    cookie: 'SESSDATA=ok',
    ignored: true,
  };

  assert.deepEqual(compareBilibiliCrawlerObjects(report, report), {
    ok: true,
    mismatches: [],
    python: {
      bvids: ['BV19yGa61Ee6'],
      bvid: 'BV19yGa61Ee6',
      blocked: true,
      cookie: 'SESSDATA=ok',
    },
    js: {
      bvids: ['BV19yGa61Ee6'],
      bvid: 'BV19yGa61Ee6',
      blocked: true,
      cookie: 'SESSDATA=ok',
    },
  });
});

test('compareBilibiliCrawler compares JS and Python crawler helper payloads', async () => {
  const result = await compareBilibiliCrawler({
    payload: {
      text: 'watch BV19yGa61Ee6 and BV1xx411c7mD',
      payload: { code: -412 },
      cookie: ' SESSDATA=abc ; bad ; DedeUserID=42\r\nx ',
      objects: [
        { kind: 'video', bvid: 'BV19yGa61Ee6', oid: '1' },
        { kind: 'video', bvid: 'BV19yGa61Ee6', oid: '1' },
        { kind: 'dynamic', id: 'dyn-1' },
      ],
      reply: {
        rpid: 100,
        mid: 42,
        member: { uname: 'tester' },
        content: { message: 'hello [doge]' },
        ctime: 1710000000,
        like: 7,
      },
      targetUid: 42,
      object: { kind: 'video', bvid: 'BV19yGa61Ee6', title: 'fixture video' },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js.bvids, ['BV19yGa61Ee6', 'BV1xx411c7mD']);
  assert.equal(result.python.blocked, true);
  assert.equal(result.python.objects.length, 1);
  assert.equal(result.python.targetReplies[0].message, 'hello [doge]');
});

test('compareBilibiliCrawler exports named offline crawler fixtures', async () => {
  assert.deepEqual(Object.keys(BILIBILI_CRAWLER_FIXTURES), [
    'identity-block-cookie',
    'objects-and-reply',
    'danmaku-and-dynamics',
  ]);

  const calls = [];
  const result = await compareBilibiliCrawler({
    fixtureNames: Object.keys(BILIBILI_CRAWLER_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name });
      return context.fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'identity-block-cookie' },
    { python: 'identity-block-cookie' },
    { js: 'objects-and-reply' },
    { python: 'objects-and-reply' },
    { js: 'danmaku-and-dynamics' },
    { python: 'danmaku-and-dynamics' },
  ]);
});
