import assert from 'node:assert/strict';
import test from 'node:test';

import { compareBilibiliParse, compareBilibiliParseObjects } from './compareBilibiliParse.js';

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
