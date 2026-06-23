import assert from 'node:assert/strict';
import test from 'node:test';

import { BILIBILI_PARSE_FIXTURES, compareBilibiliParse, compareBilibiliParseObjects } from './compareBilibiliParse.js';

test('compareBilibiliParseObjects reports matching parser summaries', () => {
  const report = {
    ok: true,
    mode: 'danmaku',
    comments: [{ message: 'same', rpid: 'danmaku-1-0' }],
    ignored: true,
  };

  assert.deepEqual(compareBilibiliParseObjects(report, report), {
    ok: true,
    mismatches: [],
    python: { mode: 'danmaku', comments: report.comments },
    js: { mode: 'danmaku', comments: report.comments },
  });
});

test('compareBilibiliParse compares JS and Python danmaku parser outputs', async () => {
  const result = await compareBilibiliParse({
    payload: {
      mode: 'danmaku',
      xml: '<i><d p="1,1,25,16777215,1710000000,0,12345,0">compare &amp; parse</d></i>',
      video: {
        bvid: 'BVcompare',
        oid: '123',
        replyType: 1,
        title: 'compare video',
        sourceUrl: 'https://www.bilibili.com/video/BVcompare/',
        cid: '456',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.js.comments[0].message, 'compare & parse');
  assert.equal(result.python.comments[0].rpid, 'danmaku-456-0');
});

test('compareBilibiliParse exports named parser fixtures', async () => {
  assert.deepEqual(Object.keys(BILIBILI_PARSE_FIXTURES), [
    'danmaku-xml',
    'extract-bvid-url',
    'bvid-pool-mixed-delimiters',
  ]);

  const calls = [];
  const result = await compareBilibiliParse({
    fixtureNames: Object.keys(BILIBILI_PARSE_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, mode: context.payload.mode });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, mode: context.payload.mode });
      return context.fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'danmaku-xml', mode: 'danmaku' },
    { python: 'danmaku-xml', mode: 'danmaku' },
    { js: 'extract-bvid-url', mode: 'extract-bvid' },
    { python: 'extract-bvid-url', mode: 'extract-bvid' },
    { js: 'bvid-pool-mixed-delimiters', mode: 'bvid-pool' },
    { python: 'bvid-pool-mixed-delimiters', mode: 'bvid-pool' },
  ]);
});
