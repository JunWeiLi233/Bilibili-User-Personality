import assert from 'node:assert/strict';
import test from 'node:test';

import {
  historyTagVideosForSearch,
  mergeBilibiliHistoryTagCorpus,
  scrapeBilibiliHistoryTags,
} from './bilibiliHistoryTags.js';

test('scrapeBilibiliHistoryTags collects only tag/video metadata', async () => {
  const urls = [];
  const result = await scrapeBilibiliHistoryTags(
    { seeds: ['乾隆'], pages: 1, pageSize: 2 },
    {
      fetchJson: async (url) => {
        urls.push(String(url));
        return {
          code: 0,
          data: {
            result: [
              {
                bvid: 'BVhistory001',
                aid: 101,
                title: '<em class="keyword">乾隆</em>老儿历史杂谈',
                description: '清朝历史',
                review: 42,
                tag: '清朝,历史',
              },
            ],
          },
        };
      },
    },
  );

  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].bvid, 'BVhistory001');
  assert.deepEqual(result.videos[0].tags, ['乾隆', '清朝', '历史']);
  assert.equal(urls.every((url) => url.includes('/x/web-interface/search/type')), true);
  assert.equal(urls.some((url) => url.includes('/x/v2/reply') || url.includes('dm/web')), false);
});

test('scrapeBilibiliHistoryTags paces repeated metadata requests', async () => {
  const waits = [];
  let calls = 0;
  await scrapeBilibiliHistoryTags(
    { seeds: ['history', 'qing'], pages: 1, pageSize: 1, delayMs: 50, jitterMs: 0 },
    {
      waitFn: async (ms) => waits.push(ms),
      fetchJson: async () => {
        calls += 1;
        return { code: 0, data: { result: [{ bvid: `BVhistory00${calls}`, aid: calls, title: 'history video' }] } };
      },
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [50]);
});

test('scrapeBilibiliHistoryTags does not wait before the first metadata request', async () => {
  const waits = [];
  await scrapeBilibiliHistoryTags(
    { seeds: ['history'], pages: 1, pageSize: 1, delayMs: 50, jitterMs: 0 },
    {
      waitFn: async (ms) => waits.push(ms),
      fetchJson: async () => ({ code: 0, data: { result: [] } }),
    },
  );

  assert.deepEqual(waits, []);
});

test('mergeBilibiliHistoryTagCorpus deduplicates videos and preserves history tag lookup', () => {
  const merged = mergeBilibiliHistoryTagCorpus(
    {
      tags: [{ name: '历史', source: 'seed' }],
      videos: [{ bvid: 'BVhistory001', title: '乾隆老儿', tags: ['历史'], replyCount: 1 }],
      runs: [],
    },
    {
      tags: [{ name: '清朝', source: 'seed' }],
      videos: [
        { bvid: 'BVhistory001', title: '乾隆老儿历史复盘', tags: ['清朝', '历史'], replyCount: 99 },
        { bvid: 'BVhistory002', title: '普通娱乐视频', tags: ['娱乐'], replyCount: 100 },
      ],
      runs: [{ at: 'now' }],
    },
  );

  assert.equal(merged.videos.length, 2);
  const matches = historyTagVideosForSearch(merged, ['乾隆老儿 评论区'], ['乾隆老儿'], 5);
  assert.deepEqual(matches.map((video) => video.bvid), ['BVhistory001']);
});
