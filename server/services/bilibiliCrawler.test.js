import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeUid,
  collectReplyForUid,
  dedupePublicObjects,
  discoverVideosByKeyword,
  discoverPopularVideos,
  extractBvid,
  extractDynamicRecords,
  fetchJson,
  fetchReplyThread,
  fetchRepliesForVideo,
  isBilibiliBlockResponse,
  parseDanmakuXml,
  parseDanmakuXmlWithPython,
  parseBvidPool,
  resetBilibiliRequestState,
  TokenBucket,
  SessionIdentity,
  getEndpointBucket,
  validateSession,
  isSessionValid,
  isSessionChecked,
  isAuthRequiredEndpoint,
  maybeRevalidateSession,
  guardAuthEndpoint,
  discoverVideosByUid,
  discoverVideosByFavorite,
  discoverDynamicsByUid,
  fetchUserPublicComments,
  initProxyRotator,
  resetWafState,
  isEndpointExhausted,
  isWafResponse,
  recordWaf,
  ENDPOINT_BUCKET_DEFAULTS,
  sessionIdentity,
  buildSecChUa,
  USER_AGENTS,
} from './bilibiliCrawler.js';

test('fetchReplyThread collects nested replies for a root comment across pages', async () => {
  const seen = [];
  const video = { bvid: 'BVx', oid: '123', replyType: 1, title: 't', sourceUrl: 'https://www.bilibili.com/video/BVx/' };
  const thread = await fetchReplyThread(video, '999', { pages: 2 }, {
    fetchJson: async (url) => {
      seen.push(String(url));
      if (String(url).includes('pn=1')) {
        return { code: 0, data: { replies: [{ rpid: 1, mid: 5, member: { mid: '5', uname: 'a' }, content: { message: '网盘见 +1' } }], page: { count: 40, size: 20, num: 1 } } };
      }
      return { code: 0, data: { replies: [{ rpid: 2, mid: 6, member: { mid: '6', uname: 'b' }, content: { message: '对，网盘见' } }], page: { count: 40, size: 20, num: 2 } } };
    },
  });
  assert.equal(thread.length, 2);
  assert.equal(thread.every((c) => c.message.includes('网盘见')), true);
  assert.equal(seen.some((u) => u.includes('/x/v2/reply/reply') && u.includes('root=999')), true);
});

test('fetchRepliesForVideo deepens reply threads only for term-bearing root comments', async () => {
  const calls = [];
  const result = await fetchRepliesForVideo(
    'BV1xx411c7mD',
    { pages: 1, deepenMatch: (msg) => /网盘见/.test(msg), deepenRootLimit: 3, deepenPages: 1 },
    {
      fetchJson: async (url) => {
        calls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return { code: 0, data: { aid: 123, title: 'v', owner: { mid: 9 }, stat: { reply: 5 } } };
        }
        // Primary endpoint: /x/v2/reply (main is deprecated)
        if (String(url).includes('/x/v2/reply?') && !String(url).includes('/x/v2/reply/reply')) {
          return {
            code: 0,
            data: {
              page: { count: 2, size: 20, num: 1 },
              replies: [
                { rpid: 100, mid: 1, member: { mid: '1', uname: 'root' }, content: { message: '网盘见' }, rcount: 5, replies: [] },
                { rpid: 200, mid: 2, member: { mid: '2', uname: 'other' }, content: { message: '无关评论' }, rcount: 0, replies: [] },
              ],
            },
          };
        }
        if (String(url).includes('/x/v2/reply/reply')) {
          return {
            code: 0,
            data: {
              replies: [
                { rpid: 101, mid: 3, member: { mid: '3', uname: 'r1' }, content: { message: '真的网盘见' } },
                { rpid: 102, mid: 4, member: { mid: '4', uname: 'r2' }, content: { message: '网盘见+1' } },
              ],
              page: { count: 2, size: 20, num: 1 },
            },
          };
        }
        return { code: 0, data: {} };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some((u) => u.includes('/x/v2/reply/reply') && u.includes('root=100')), true);
  assert.equal(calls.some((u) => u.includes('root=200')), false);
  const messages = result.comments.map((c) => c.message);
  assert.equal(messages.includes('真的网盘见'), true);
  assert.equal(messages.includes('网盘见+1'), true);
  assert.equal(result.comments.length, 4);
});

test('fetchRepliesForVideo skips deepening when no deepenMatch is provided', async () => {
  const calls = [];
  const result = await fetchRepliesForVideo(
    'BV1xx411c7mD',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        calls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return { code: 0, data: { aid: 123, title: 'v', owner: { mid: 9 }, stat: { reply: 5 } } };
        }
        // Primary endpoint is now /x/v2/reply (main is deprecated)
        if (String(url).includes('/x/v2/reply?') && !String(url).includes('/x/v2/reply/reply')) {
          return {
            code: 0,
            data: { page: { count: 1, size: 20, num: 1 }, replies: [{ rpid: 100, mid: 1, member: { mid: '1', uname: 'root' }, content: { message: '网盘见' }, rcount: 5, replies: [] }] },
          };
        }
        return { code: 0, data: {} };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some((u) => u.includes('/x/v2/reply/reply')), false);
  assert.equal(result.comments.length, 1);
});

test('discoverVideosByKeyword searches Bilibili and normalizes video objects', async () => {
  const seenUrls = [];
  const videos = await discoverVideosByKeyword('阴阳怪气', 2, {
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return {
        code: 0,
        data: {
          result: [
            {
              result_type: 'video',
              data: [
                {
                  aid: 123,
                  bvid: 'BV19yGa61Ee6',
                  title: '<em class="keyword">阴阳怪气</em> sample',
                  mid: 9,
                  arcurl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
                  review: 12,
                },
              ],
            },
          ],
        },
      };
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].bvid, 'BV19yGa61Ee6');
  assert.equal(videos[0].title, '阴阳怪气 sample');
  assert.equal(videos[0].replyCount, 12);
  assert.equal(seenUrls[0].url.includes('/x/web-interface/search/all/v2'), true);
  assert.equal(seenUrls[0].url.includes('keyword='), true);
  assert.equal(seenUrls[0].referer.includes('search.bilibili.com'), true);
});

test('discoverVideosByKeyword can request a search order for popular controversial seeds', async () => {
  const seenUrls = [];
  await discoverVideosByKeyword('游戏 节奏 评论区', 2, {
    searchOrder: 'click',
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return { code: 0, data: { result: [] } };
    },
  });

  const parsed = new URL(seenUrls[0].url);
  assert.equal(parsed.searchParams.get('keyword'), '游戏 节奏 评论区');
  assert.equal(parsed.searchParams.get('order'), 'click');
});

test('discoverVideosByKeyword can scan multiple search result pages', async () => {
  const seenPages = [];
  const videos = await discoverVideosByKeyword('hard term', 2, {
    searchPages: 2,
    fetchJson: async (url) => {
      const parsed = new URL(String(url));
      const page = parsed.searchParams.get('page');
      seenPages.push(page);
      if (page === '1') return { code: 0, data: { result: [] } };
      return {
        code: 0,
        data: {
          result: [
            {
              result_type: 'video',
              data: [
                {
                  aid: 456,
                  bvid: 'BV1pageTwo',
                  title: 'page two result',
                  mid: 9,
                  arcurl: 'https://www.bilibili.com/video/BV1pageTwo/',
                  review: 3,
                },
              ],
            },
          ],
        },
      };
    },
  });

  assert.deepEqual(seenPages, ['1', '2']);
  assert.deepEqual(videos.map((video) => video.bvid), ['BV1pageTwo']);
});

test('discoverPopularVideos reads public popular videos and normalizes video objects', async () => {
  const seenUrls = [];
  const videos = await discoverPopularVideos(2, {
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return {
        code: 0,
        data: {
          result: [
            {
              result_type: 'video',
              data: [
                {
                  aid: 456,
                  bvid: 'BV1pageTwo',
                  title: 'page two result',
                  mid: 9,
                  arcurl: 'https://www.bilibili.com/video/BV1pageTwo/',
                  review: 3,
                },
              ],
            },
          ],
        },
      };
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].bvid, 'BV1xx411c7mD');
  assert.equal(videos[0].title, 'popular sample');
  assert.equal(videos[0].replyCount, 22);
  assert.equal(seenUrls[0].url.includes('/x/web-interface/popular'), true);
  assert.equal(seenUrls[0].referer, 'https://www.bilibili.com/v/popular/all');
});

test('parseBvidPool accepts whitespace, comma, and Chinese comma separators', () => {
  assert.deepEqual(parseBvidPool('BV19yGa61Ee6, BV1xx411c7mD，BVabc1234567  bad-id'), [
    'BV19yGa61Ee6',
    'BV1xx411c7mD',
    'BVabc1234567',
  ]);
});

test('extractBvid accepts BV ids and Bilibili video links', () => {
  assert.equal(extractBvid('BV19yGa61Ee6'), 'BV19yGa61Ee6');
  assert.equal(extractBvid('https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=abc'), 'BV19yGa61Ee6');
  assert.equal(extractBvid('https://b23.tv/BV1xx411c7mD'), 'BV1xx411c7mD');
  assert.equal(extractBvid('not-a-video'), '');
});

test('extractBvid accepts varied Bilibili video URL formats', () => {
  // URL without https:// prefix
  assert.equal(extractBvid('bilibili.com/video/BV1dcjf6eEJm/'), 'BV1dcjf6eEJm');
  // URL with long tracking query params
  assert.equal(extractBvid('https://www.bilibili.com/video/BV1FQT36XErW/?vd_source=d3f6474bdf9e6de8d027785f1120afd4'), 'BV1FQT36XErW');
  // URL without www subdomain
  assert.equal(extractBvid('https://bilibili.com/video/BV1zQjc65ErS/'), 'BV1zQjc65ErS');
  // URL with trailing query params
  assert.equal(extractBvid('https://www.bilibili.com/video/BV1zQjc65ErS/?vd_source=d3f6474bdf9e6de8d027785f1120afd4'), 'BV1zQjc65ErS');
  // b23.tv short link with tracking
  assert.equal(extractBvid('https://b23.tv/BV1xx411c7mD?t=30'), 'BV1xx411c7mD');
  // URL with fragment
  assert.equal(extractBvid('https://www.bilibili.com/video/BV19yGa61Ee6/#reply'), 'BV19yGa61Ee6');
});

test('extractBvid rejects invalid formats', () => {
  // Pure text
  assert.equal(extractBvid('not-a-video'), '');
  // AV id (old format, not supported)
  assert.equal(extractBvid('https://www.bilibili.com/video/av170001'), '');
  // Space URL (should not extract BV from user page)
  assert.equal(extractBvid('https://space.bilibili.com/352468828'), '');
  // Empty string
  assert.equal(extractBvid(''), '');
});

test('isBilibiliBlockResponse detects Bilibili block and rate-limit payloads', () => {
  assert.equal(isBilibiliBlockResponse({ code: -352 }), true);
  assert.equal(isBilibiliBlockResponse({ code: -412 }), true);
  assert.equal(isBilibiliBlockResponse({ code: 0 }), false);
});

test('fetchJson spaces requests and cools down after Bilibili block responses', async () => {
  resetBilibiliRequestState();
  let now = 1000;
  const waits = [];
  const responses = [{ code: 0, data: { ok: 1 } }, { code: -352, message: '-352' }, { code: 0, data: { ok: 2 } }];

  const options = {
    env: {},
    config: {
      minDelayMs: 100,
      jitterMs: 0,
      blockCooldownMs: 1000,
      cacheTtlMs: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => responses.shift(),
    }),
  };

  await fetchJson('https://api.bilibili.com/one', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/two', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/three', 'https://www.bilibili.com', options);

  assert.deepEqual(waits, [100, 1000]);
  resetBilibiliRequestState();
});

test('fetchJson backs off exponentially when consecutive Bilibili block responses occur', async () => {
  resetBilibiliRequestState();
  let now = 0;
  const waits = [];
  const responses = [
    { code: -352, message: '-352' },
    { code: -352, message: '-352' },
    { code: 0, data: {} },
  ];
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 100,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
  };

  await fetchJson('https://api.bilibili.com/a', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/b', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/c', 'https://www.bilibili.com', options);

  // First block: cooldown = 100. Second block: cooldown grows to 200 (2x). Third call waits 200ms.
  assert.deepEqual(waits, [100, 200]);
  resetBilibiliRequestState();
});

test('fetchJson sends a session-sticky user agent with Chrome client-hint headers and Bilibili cookies', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => 1700000000000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (url, init) => {
      seenHeaders.push(init.headers);
      return { ok: true, json: async () => ({ code: 0, data: {} }) };
    },
  };

  await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', options);
  await fetchJson('https://api.bilibili.com/y', 'https://space.bilibili.com/123', options);

  assert.equal(seenHeaders.length, 2);
  assert.equal(seenHeaders[0]['user-agent'], seenHeaders[1]['user-agent']);
  assert.match(seenHeaders[0]['user-agent'], /Chrome\/\d+/);
  assert.equal(seenHeaders[0]['accept-language'], 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.ok(seenHeaders[0]['sec-ch-ua']);
  assert.equal(seenHeaders[0]['sec-ch-ua-mobile'], '?0');
  assert.match(seenHeaders[0]['sec-ch-ua-platform'], /"\w+"/);
  assert.equal(seenHeaders[0]['sec-fetch-mode'], 'cors');
  assert.equal(seenHeaders[0]['sec-fetch-dest'], 'empty');
  assert.equal(seenHeaders[0]['sec-fetch-site'], 'same-site');
  assert.equal(seenHeaders[0].origin, 'https://www.bilibili.com');
  assert.ok(seenHeaders[0].cookie.includes('buvid3='));
  assert.ok(seenHeaders[0].cookie.includes('b_nut='));
  assert.ok(seenHeaders[0].cookie.includes('_uuid='));
  resetBilibiliRequestState();
});

test('fetchJson uses configured Bilibili cookie when provided', async () => {
  resetBilibiliRequestState();
  const previousCookie = process.env.BILIBILI_COOKIE;
  process.env.BILIBILI_COOKIE = 'SESSDATA=session-value; bili_jct=csrf-value';
  try {
    const seenHeaders = [];
    await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', {
      env: {},
      config: {
        minDelayMs: 0,
        jitterMs: 0,
        blockCooldownMs: 0,
        cacheTtlMs: 0,
        longPauseProbability: 0,
      },
      nowFn: () => 1700000000000,
      randomFn: () => 0,
      waitFn: async () => {},
      fetchImpl: async (_url, init) => {
        seenHeaders.push(init.headers);
        return { ok: true, json: async () => ({ code: 0, data: {} }) };
      },
    });

    assert.equal(seenHeaders[0].cookie, 'SESSDATA=session-value; bili_jct=csrf-value');
  } finally {
    if (previousCookie === undefined) {
      delete process.env.BILIBILI_COOKIE;
    } else {
      process.env.BILIBILI_COOKIE = previousCookie;
    }
    resetBilibiliRequestState();
  }
});

test('fetchJson can use a per-request Bilibili login cookie without caching it', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  let calls = 0;
  const options = {
    bilibiliCookie: 'SESSDATA=session-value; bili_jct=csrf-value; invalid; bad\r\nname=x',
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 60000,
      longPauseProbability: 0,
    },
    nowFn: () => 1700000000000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      seenHeaders.push(init.headers);
      return { ok: true, json: async () => ({ code: 0, data: { calls } }) };
    },
  };

  await fetchJson('https://api.bilibili.com/login-only', 'https://www.bilibili.com/video/BVxxx/', options);
  await fetchJson('https://api.bilibili.com/login-only', 'https://www.bilibili.com/video/BVxxx/', options);

  assert.equal(calls, 2);
  assert.match(seenHeaders[0].cookie, /SESSDATA=session-value/);
  assert.match(seenHeaders[0].cookie, /bili_jct=csrf-value/);
  assert.doesNotMatch(seenHeaders[0].cookie, /bad/);
  resetBilibiliRequestState();
});

test('analyzeUid forwards user Bilibili cookie through UID object scans', async () => {
  const seenCookies = [];
  const result = await analyzeUid(
    {
      uid: '453244911',
      objectLimit: 1,
      dynamicLimit: 0,
      pagesPerObject: 1,
      bilibiliCookie: 'SESSDATA=session-value; bili_jct=csrf-value',
    },
    {
      fetchJson: async (url, _referer, options = {}) => {
        seenCookies.push(options.bilibiliCookie || '');
        if (String(url).includes('/x/web-interface/nav')) {
          return { code: 0, data: { isLogin: true, mid: 453244911, uname: 'test_user' } };
        }
        if (String(url).includes('/x/web-interface/card')) {
          return { code: 0, card: { mid: '453244911', name: 'target user', sign: '' } };
        }
        if (String(url).includes('/x/space/arc/search')) {
          return {
            code: 0,
            data: {
              list: {
                vlist: [
                  {
                    aid: 123,
                    bvid: 'BV19yGa61Ee6',
                    title: 'user upload',
                    author: 'target user',
                  },
                ],
              },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: '453244911',
                member: { mid: '453244911', uname: 'target user' },
                content: { message: '\u767b\u5f55 cookie \u626b\u5230 UID \u4e92\u52a8' },
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(seenCookies.every((cookie) => cookie === 'SESSDATA=session-value; bili_jct=csrf-value'), true);
});

test('fetchJson caches successful Bilibili JSON responses for repeated reads', async () => {
  resetBilibiliRequestState();
  let calls = 0;
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 1000,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ code: 0, data: { calls } }),
      };
    },
  };

  const first = await fetchJson('https://api.bilibili.com/cache', 'https://www.bilibili.com', options);
  const second = await fetchJson('https://api.bilibili.com/cache', 'https://www.bilibili.com', options);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  resetBilibiliRequestState();
});

test('fetchJson passes an abort signal so stalled Bilibili requests can time out', async () => {
  resetBilibiliRequestState();
  await fetchJson('https://api.bilibili.com/timeout', 'https://www.bilibili.com', {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 500,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.ok(init.signal);
      assert.equal(init.signal.aborted, false);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
});

test('fetchJson forwards caller abort signal to Bilibili requests', async () => {
  resetBilibiliRequestState();
  const controller = new AbortController();
  await fetchJson('https://api.bilibili.com/external-abort', 'https://www.bilibili.com', {
    env: {},
    signal: controller.signal,
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 0,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
});

test('fetchJson preserves caller abort state when request timeout is also enabled', async () => {
  resetBilibiliRequestState();
  const controller = new AbortController();
  controller.abort();
  await fetchJson('https://api.bilibili.com/external-and-timeout-abort', 'https://www.bilibili.com', {
    env: {},
    signal: controller.signal,
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 500,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal.aborted, true);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
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

test('fetchRepliesForVideo collects public top-level and nested video comments', async () => {
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '测试视频',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 2 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '不会真有人觉得这叫证据吧' },
                like: 3,
                ctime: 1710000000,
                replies: [
                  {
                    rpid: 2,
                    mid: 101,
                    member: { mid: '101', uname: 'bob' },
                    content: { message: '懂的都懂，自己查' },
                    like: 1,
                    ctime: 1710000001,
                  },
                ],
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.video.bvid, 'BV19yGa61Ee6');
  assert.equal(result.comments.length, 2);
  assert.equal(result.commentText.includes('不会真有人'), true);
  assert.equal(result.commentText.includes('懂的都懂'), true);
});

test('parseDanmakuXml extracts public danmaku messages', () => {
  const items = parseDanmakuXml(
    '<i><d p="1,1,25,16777215,1710000000,0,12345,0">别喷我 &amp; 不吹不黑</d></i>',
    {
      bvid: 'BV1danmaku',
      oid: '123',
      replyType: 1,
      title: 'danmaku video',
      sourceUrl: 'https://www.bilibili.com/video/BV1danmaku/',
      cid: '456',
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].message, '别喷我 & 不吹不黑');
  assert.equal(items[0].kind, 'danmaku');
  assert.equal(items[0].rpid, 'danmaku-456-0');
});

test('parseDanmakuXmlWithPython delegates danmaku XML parsing through JSON contracts', async () => {
  const calls = [];
  const video = {
    bvid: 'BVpython',
    oid: '123',
    replyType: 1,
    title: 'python video',
    sourceUrl: 'https://www.bilibili.com/video/BVpython/',
    cid: '456',
  };
  const xml = '<i><d p="1,1,25,16777215,1710000000,0,12345,0">python bridge</d></i>';
  const comments = await parseDanmakuXmlWithPython(xml, video, {
    runPythonParse: async (payload) => {
      calls.push(payload);
      return { ok: true, mode: 'danmaku', comments: [{ message: 'python bridge', kind: 'danmaku', rpid: 'danmaku-456-0' }] };
    },
  });

  assert.deepEqual(comments, [{ message: 'python bridge', kind: 'danmaku', rpid: 'danmaku-456-0' }]);
  assert.deepEqual(calls, [{ mode: 'danmaku', xml, video }]);
});

test('fetchRepliesForVideo can include public danmaku as interaction text', async () => {
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1, includeDanmaku: true },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              cid: 456,
              title: 'danmaku source',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      fetchBuffer: async () => {
        // Return empty buffer to trigger XML fallback
        return new ArrayBuffer(0);
      },
      fetchText: async (url) => {
        assert.equal(String(url), 'https://api.bilibili.com/x/v1/dm/list.so?oid=456');
        return '<i><d p="1,1,25,16777215,1710000000,0,12345,0">轻点喷</d></i>';
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].kind, 'danmaku');
  assert.equal(result.commentText.includes('轻点喷'), true);
});

test('fetchRepliesForVideo can opt into Python danmaku parsing', async () => {
  const parseCalls = [];
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    {
      pages: 1,
      includeDanmaku: true,
      usePythonParser: true,
      runPythonParse: async (payload) => {
        parseCalls.push(payload);
        return {
          ok: true,
          mode: 'danmaku',
          comments: [
            {
              bvid: payload.video.bvid,
              oid: payload.video.oid,
              replyType: payload.video.replyType,
              sourceTitle: payload.video.title,
              sourceUrl: payload.video.sourceUrl,
              rpid: 'danmaku-456-0',
              like: 0,
              ctime: 1710000000,
              uname: '',
              mid: '12345',
              message: 'python parsed danmaku',
              kind: 'danmaku',
            },
          ],
        };
      },
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              cid: 456,
              title: 'danmaku source',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      fetchBuffer: async () => {
        // Return empty buffer to trigger XML fallback
        return new ArrayBuffer(0);
      },
      fetchText: async () => '<i><d p="1,1,25,16777215,1710000000,0,12345,0">js would parse this</d></i>',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].message, 'python parsed danmaku');
  assert.equal(parseCalls.length, 1);
  assert.equal(parseCalls[0].video.cid, '456');
});

test('fetchRepliesForVideo falls back to main cursor API when page-based reply is blocked', async () => {
  const seen = [];
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        seen.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'fallback video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        // Primary: /x/v2/reply is now the default; /x/v2/reply/main is the fallback
        if (String(url).includes('/x/v2/reply?') && !String(url).includes('/x/v2/reply/reply')) {
          return { code: -352, message: '-352' };
        }
        if (String(url).includes('/x/v2/reply/main')) {
          return {
            code: 0,
            data: {
              replies: [
                {
                  rpid: 10,
                  mid: 100,
                  member: { mid: '100', uname: 'alice' },
                  content: { message: '典中典，自己查' },
                  like: 2,
                  ctime: 1710000000,
                },
              ],
              cursor: { is_end: true, next: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.commentText.includes('典中典'), true);
  assert.equal(seen.some((url) => url.includes('/x/v2/reply/main')), true);
});

// ── Problem 1: TokenBucket tests ──────────────────────────────────────────────

test('TokenBucket: tokens are consumed and refilled over time', async () => {
  let now = 0;
  const waits = [];
  const bucket = new TokenBucket(8, 2, () => now);
  const waitFn = async (ms) => { waits.push(ms); now += ms; };

  // Consume all 8 burst tokens instantly (no wait)
  for (let i = 0; i < 8; i++) {
    const w = await bucket.take(waitFn);
    assert.equal(w, 0);
  }
  assert.deepEqual(waits, []);

  // 9th token requires waiting (sustain=2/sec → 500ms per token)
  const w = await bucket.take(waitFn);
  assert.ok(w > 0);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 400); // ~500ms
});

test('TokenBucket: respects burst and sustain overrides', async () => {
  let now = 0;
  const waits = [];
  const bucket = new TokenBucket(3, 10, () => now);
  const waitFn = async (ms) => { waits.push(ms); now += ms; };

  // Consume 3 burst tokens
  for (let i = 0; i < 3; i++) {
    assert.equal(await bucket.take(waitFn), 0);
  }
  // 4th token with sustain=10/sec → ~100ms wait
  const w = await bucket.take(waitFn);
  assert.ok(w > 0 && w <= 200);
  assert.equal(waits.length, 1);
});

test('TokenBucket: refill over time restores tokens', async () => {
  let now = 0;
  const bucket = new TokenBucket(4, 2, () => now); // sustain=2/sec
  const waitFn = async (_ms) => {}; // no-op

  // Consume 4 burst tokens
  for (let i = 0; i < 4; i++) {
    assert.equal(await bucket.take(waitFn), 0);
  }

  // Advance time by 2 seconds (should refill 4 tokens at 2/sec)
  now += 2000;
  assert.ok(bucket.available >= 3); // a bit less than 4 due to floating point
});

test('TokenBucket: reset restores full burst', async () => {
  let now = 0;
  const bucket = new TokenBucket(5, 1, () => now);
  const waitFn = async () => {};

  for (let i = 0; i < 5; i++) await bucket.take(waitFn);
  assert.ok(bucket.available < 1);

  bucket.reset();
  assert.ok(bucket.available >= 4.9); // close to full burst
});

test('getEndpointBucket: returns different buckets for different endpoints', () => {
  const searchBucket = getEndpointBucket('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=test', Date.now, {});
  const viewBucket = getEndpointBucket('https://api.bilibili.com/x/web-interface/view?bvid=BVxxx', Date.now, {});
  // Different endpoints → different bucket instances
  assert.notEqual(searchBucket, viewBucket);
});

test('getEndpointBucket: respects BILIBILI_RATE_BURST and BILIBILI_RATE_SUSTAIN overrides', () => {
  const bucket = getEndpointBucket('https://api.bilibili.com/x/v2/reply/main?oid=123&type=1&mode=3', Date.now, {
    BILIBILI_RATE_BURST: '15',
    BILIBILI_RATE_SUSTAIN: '5',
  });
  assert.ok(bucket.available > 10);
});

test('fetchJson: TokenBucket throttles 50-request burst — no -412 storm', async () => {
	resetBilibiliRequestState();
	let now = 0;
	const requestTimestamps = [];
	let blockCount = 0;

	const options = {
		env: {},
		config: {
			minDelayMs: 0,
			jitterMs: 0,
			blockCooldownMs: 0,
			cacheTtlMs: 0,
			longPauseProbability: 0,
		},
		nowFn: () => now,
		randomFn: () => 0,
		waitFn: async (ms) => { now += ms; },
		fetchImpl: async () => {
			requestTimestamps.push(now);
			return { ok: true, json: async () => ({ code: 0, data: {} }) };
		},
	};

	// Fire 50 requests sequentially — TokenBucket must serialize beyond burst
	for (let i = 0; i < 50; i++) {
		const result = await fetchJson(
			`https://api.bilibili.com/x/v2/reply/main?oid=${i}&type=1&mode=3`,
			'https://www.bilibili.com',
			options,
		);
		if (isBilibiliBlockResponse(result)) blockCount++;
	}

	assert.equal(requestTimestamps.length, 50);
	assert.equal(blockCount, 0, 'No -412 block responses should occur');

	// First 10 requests at t=0 (burst=10 for /x/v2/reply/main)
	for (let i = 0; i < 10 && i < requestTimestamps.length; i++) {
		assert.equal(requestTimestamps[i], 0, `Request ${i} should fire at burst (t=0)`);
	}

	// After burst, sustain=3/sec → ~333ms between requests.
	// Every gap from request 11 onward must be ≥ 250ms (allow small float tolerance).
	for (let i = 10; i < requestTimestamps.length; i++) {
		const gap = requestTimestamps[i] - requestTimestamps[i - 1];
		assert.ok(
			gap >= 250,
			`Request ${i} fired only ${gap}ms after request ${i - 1} — expected ≥ ~333ms (sustain=3/sec)`,
		);
	}

	// Also verify: all 40 post-burst requests together take at least 12s
	// (40 tokens / 3 per sec ≈ 13.3s; allow 11s min for rounding)
	const postBurstSpan = requestTimestamps[49] - requestTimestamps[9];
	assert.ok(
		postBurstSpan >= 11000,
		`40 post-burst requests spanned only ${postBurstSpan}ms, expected ≥ 11000ms`,
	);

	resetBilibiliRequestState();
});

// ── Problem 2: ProxyRotator tests ─────────────────────────────────────────────

test('ProxyRotator: initProxyRotator with comma-separated list does not throw', () => {
  resetBilibiliRequestState();
  // Should initialize without throwing
  initProxyRotator({ BILIBILI_PROXY_LIST: 'http://proxy1:8080,http://proxy2:8080,http://proxy3:8080' });
  // Verify state is clean after reset
  resetBilibiliRequestState();
});

test('ProxyRotator: initProxyRotator with empty string is a no-op', () => {
  resetBilibiliRequestState();
  initProxyRotator({ BILIBILI_PROXY_LIST: '' });
  // Should not throw — proxy rotator stays null
});

test('ProxyRotator: initProxyRotator with whitespace in entries trims them', () => {
  resetBilibiliRequestState();
  initProxyRotator({ BILIBILI_PROXY_LIST: '  http://proxy1:8080  ,  http://proxy2:9090  ' });
  // Should trim entries and initialize cleanly
  resetBilibiliRequestState();
});

test('ProxyRotator: fetchJson with proxy configured still applies block cooldown', async () => {
  resetBilibiliRequestState();
  initProxyRotator({ BILIBILI_PROXY_LIST: 'http://proxy1:8080,http://proxy2:8080' });
  let now = 1000;
  const waits = [];
  const responses = [
    { code: -352, message: '-352' }, // block → triggers markBlock on proxy
    { code: 0, data: { ok: 1 } },
  ];

  const options = {
    env: {},
    config: {
      minDelayMs: 100,
      jitterMs: 0,
      blockCooldownMs: 1000,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => responses.shift(),
    }),
  };

  await fetchJson('https://api.bilibili.com/proxy-block-test-a', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/proxy-block-test-b', 'https://www.bilibili.com', options);

  // First call triggers block → 1000ms cooldown. Second call waits.
  assert.ok(waits.length >= 1, 'should have at least one wait for block cooldown');
  assert.ok(waits[0] >= 100, `expected cooldown ≥ 100ms, got ${waits[0]}`);
  resetBilibiliRequestState();
});

test('ProxyRotator: block responses rotate proxy via markBlock', async () => {
  resetBilibiliRequestState();
  initProxyRotator({ BILIBILI_PROXY_LIST: 'http://proxy-a:8080,http://proxy-b:8080' });
  let now = 0;
  const waits = [];
  // 4 block responses: triggers block cooldown on each, rotating through proxies
  const responses = [
    { code: -352, message: '-352' },
    { code: -352, message: '-352' },
    { code: -352, message: '-352' },
    { code: -352, message: '-352' },
  ];

  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 100,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => responses.shift(),
    }),
  };

  // All 4 calls completed (no throw from quarantine deadlock).
  // First request fires immediately (cooldownUntil=0, nextRequestAt=0).
  // Requests 2-4 each wait for escalating block cooldown: 100ms, 200ms, 400ms.
  await fetchJson('https://api.bilibili.com/proxy-storm-1', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/proxy-storm-2', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/proxy-storm-3', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/proxy-storm-4', 'https://www.bilibili.com', options);

  assert.equal(waits.length, 3, 'requests 2-4 should have waited for block cooldown');
  // After 3 consecutive blocks on proxy-a, markBlock quarantines it.
  // But proxy-b is still available, so request 4 still succeeds.
  resetBilibiliRequestState();
});

// ── Problem 4: WAF early-exit tests ───────────────────────────────────────────

test('WAF early-exit: endpoint exhausted after 3 consecutive WAFs', () => {
  resetBilibiliRequestState();
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/web-interface/search/type?keyword=test'), false);

  recordWaf('https://api.bilibili.com/x/web-interface/search/type?keyword=test', null);
  recordWaf('https://api.bilibili.com/x/web-interface/search/type?keyword=test', null);
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/web-interface/search/type?keyword=test'), false);

  recordWaf('https://api.bilibili.com/x/web-interface/search/type?keyword=test', null);
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/web-interface/search/type?keyword=test'), true);
});

test('WAF early-exit: total WAFs across endpoints aborts run', () => {
  resetBilibiliRequestState();

  // 5 WAFs across different endpoints should throw
  assert.throws(() => {
    recordWaf('https://api.bilibili.com/x/web-interface/search/type?k=a', null);
    recordWaf('https://api.bilibili.com/x/v2/reply/main?oid=1&type=1&mode=3', null);
    recordWaf('https://api.bilibili.com/x/web-interface/card?mid=1', null);
    recordWaf('https://api.bilibili.com/x/space/arc/search?mid=1', null);
    recordWaf('https://api.bilibili.com/x/web-interface/view?bvid=BVx', null);
  }, /aborted/);
});

test('WAF early-exit: reset clears exhaustion state', () => {
  resetBilibiliRequestState();
  recordWaf('https://api.bilibili.com/x/web-interface/search/type?k=a', null);
  recordWaf('https://api.bilibili.com/x/web-interface/search/type?k=a', null);
  recordWaf('https://api.bilibili.com/x/web-interface/search/type?k=a', null);
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/web-interface/search/type?k=a'), true);

  resetBilibiliRequestState();
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/web-interface/search/type?k=a'), false);
});

test('isWafResponse: classifies HTTP 403 as WAF', () => {
  assert.equal(isWafResponse(403), true);
  assert.equal(isWafResponse(403, null), true);
  assert.equal(isWafResponse(403, {}), true);
});

test('isWafResponse: classifies HTTP 503 as WAF', () => {
  assert.equal(isWafResponse(503), true);
  assert.equal(isWafResponse(503, null), true);
  assert.equal(isWafResponse(503, {}), true);
});

test('isWafResponse: classifies API block code -101 as WAF', () => {
  assert.equal(isWafResponse(200, { code: -101 }), true);
  assert.equal(isWafResponse(200, { code: -101, message: 'blocked' }), true);
});

test('isWafResponse: classifies API block code -111 as WAF', () => {
  assert.equal(isWafResponse(200, { code: -111 }), true);
  assert.equal(isWafResponse(200, { code: -111, message: 'blocked' }), true);
});

test('isWafResponse: returns false for non-WAF HTTP statuses', () => {
  assert.equal(isWafResponse(200), false);
  assert.equal(isWafResponse(412), false);
  assert.equal(isWafResponse(429), false);
  assert.equal(isWafResponse(500), false);
});

test('isWafResponse: returns false for non-WAF block codes', () => {
  assert.equal(isWafResponse(200, { code: -352 }), false);
  assert.equal(isWafResponse(200, { code: -412 }), false);
  assert.equal(isWafResponse(200, { code: 0 }), false);
  assert.equal(isWafResponse(200, { code: -509 }), false);
});

test('isWafResponse: returns false with no arguments', () => {
  assert.equal(isWafResponse(), false);
  assert.equal(isWafResponse(undefined, undefined), false);
});

// ── Problem 3: UA pool expansion and dynamic sec-ch-ua test ────────────────────

test('fetchJson generates dynamic sec-ch-ua matching the selected browser', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  // Pin a Firefox UA via env override
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';
  try {
    await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', {
      env: {},
      config: { minDelayMs: 0, jitterMs: 0, blockCooldownMs: 0, cacheTtlMs: 0, longPauseProbability: 0 },
      nowFn: () => 1700000000000,
      randomFn: () => 0,
      waitFn: async () => {},
      fetchImpl: async (_url, init) => {
        seenHeaders.push(init.headers);
        return { ok: true, json: async () => ({ code: 0, data: {} }) };
      },
    });
    // Firefox should NOT have sec-ch-ua
    assert.equal('sec-ch-ua' in seenHeaders[0], false);
    assert.ok(seenHeaders[0]['user-agent'].includes('Firefox'));
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
    resetBilibiliRequestState();
  }
});

test('fetchJson sends Chrome sec-ch-ua headers by default', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  // Pin a Chrome UA
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  try {
    await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', {
      env: {},
      config: { minDelayMs: 0, jitterMs: 0, blockCooldownMs: 0, cacheTtlMs: 0, longPauseProbability: 0 },
      nowFn: () => 1700000000000,
      randomFn: () => 0,
      waitFn: async () => {},
      fetchImpl: async (_url, init) => {
        seenHeaders.push(init.headers);
        return { ok: true, json: async () => ({ code: 0, data: {} }) };
      },
    });
    assert.equal(seenHeaders[0]['sec-ch-ua'], '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="99"');
    assert.equal(seenHeaders[0]['sec-ch-ua-mobile'], '?0');
    assert.equal(seenHeaders[0]['sec-ch-ua-platform'], '"Windows"');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
    resetBilibiliRequestState();
  }
});

// ── Problem 6: Session validation tests ───────────────────────────────────────

test('validateSession: returns isLogin=true for valid session', async () => {
  resetBilibiliRequestState();
  const result = await validateSession({
    fetchJson: async () => ({
      code: 0,
      data: { isLogin: true, mid: 12345, uname: 'test_user' },
    }),
  });
  assert.equal(result.isLogin, true);
  assert.equal(result.mid, '12345');
  assert.equal(result.uname, 'test_user');
  assert.equal(isSessionValid(), true);
  assert.equal(isSessionChecked(), true);
  resetBilibiliRequestState();
});

test('validateSession: returns isLogin=false for logged-out session', async () => {
  resetBilibiliRequestState();
  const result = await validateSession({
    fetchJson: async () => ({
      code: 0,
      data: { isLogin: false },
    }),
  });
  assert.equal(result.isLogin, false);
  assert.equal(isSessionValid(), false);
  resetBilibiliRequestState();
});

test('validateSession: handles network errors gracefully', async () => {
  resetBilibiliRequestState();
  const result = await validateSession({
    fetchJson: async () => { throw new Error('Network error'); },
  });
  assert.equal(result, null);
  assert.equal(isSessionValid(), false);
  resetBilibiliRequestState();
});

test('isAuthRequiredEndpoint: identifies auth-required URLs', () => {
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/space/arc/search?mid=123'), true);
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1'), true);
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space'), true);
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/v2/reply/search?mid=123'), true);
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/web-interface/view?bvid=BVx'), false);
  assert.equal(isAuthRequiredEndpoint('https://api.bilibili.com/x/web-interface/card?mid=1'), false);
});

test('resetBilibiliRequestState: clears all state including buckets, WAF, proxy, session', () => {
  resetBilibiliRequestState();
  // Set some state
  recordWaf('https://api.bilibili.com/x/test', null);
  recordWaf('https://api.bilibili.com/x/test', null);
  recordWaf('https://api.bilibili.com/x/test', null);
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/test'), true);

  resetBilibiliRequestState();
  // All state should be cleared
  assert.equal(isEndpointExhausted('https://api.bilibili.com/x/test'), false);
  assert.equal(isSessionChecked(), false);
});

// ── Re-validation & caller guard tests ─────────────────────────────────────────

test('maybeRevalidateSession: skips when recently validated (within interval)', async () => {
  resetBilibiliRequestState();
  // First validation: establish a valid session
  let callCount = 0;
  await maybeRevalidateSession({
    fetchJson: async () => { callCount++; return { code: 0, data: { isLogin: true, mid: 1, uname: 'u' } }; },
  });
  assert.equal(callCount, 1);
  assert.equal(isSessionValid(), true);

  // Second call: should skip (within 30-min default interval)
  await maybeRevalidateSession({
    fetchJson: async () => { callCount++; return { code: 0, data: { isLogin: true, mid: 1, uname: 'u' } }; },
  });
  assert.equal(callCount, 1); // no additional call
  resetBilibiliRequestState();
});

test('maybeRevalidateSession: re-validates after configured interval', async () => {
  resetBilibiliRequestState();
  // Pin the interval to 0 so every call re-validates
  process.env.BILIBILI_SESSION_CHECK_INTERVAL_MS = '0';
  let callCount = 0;
  try {
    await maybeRevalidateSession({
      fetchJson: async () => { callCount++; return { code: 0, data: { isLogin: true, mid: 1, uname: 'u' } }; },
    });
    assert.equal(callCount, 1);
    await maybeRevalidateSession({
      fetchJson: async () => { callCount++; return { code: 0, data: { isLogin: true, mid: 1, uname: 'u' } }; },
    });
    assert.equal(callCount, 2); // re-validated because interval=0
  } finally {
    delete process.env.BILIBILI_SESSION_CHECK_INTERVAL_MS;
  }
  resetBilibiliRequestState();
});

test('guardAuthEndpoint: throws when session is known-invalid', () => {
  resetBilibiliRequestState();
  // Simulate: validateSession already ran and found the session invalid
  validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: false } }) }).then(() => {
    assert.equal(isSessionChecked(), true);
    assert.equal(isSessionValid(), false);
    assert.throws(
      () => guardAuthEndpoint('https://api.bilibili.com/x/space/arc/search?mid=123'),
      /Bilibili session invalid.*auth-required/,
    );
    resetBilibiliRequestState();
  });
});

test('guardAuthEndpoint: no-op when session is valid', async () => {
  resetBilibiliRequestState();
  await validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: true, mid: 1, uname: 'u' } }) });
  // Should not throw
  guardAuthEndpoint('https://api.bilibili.com/x/space/arc/search?mid=123');
  guardAuthEndpoint('https://api.bilibili.com/x/v2/reply/search?mid=123');
  resetBilibiliRequestState();
});

test('guardAuthEndpoint: no-op when session has never been checked', () => {
  resetBilibiliRequestState();
  assert.equal(isSessionChecked(), false);
  // Should not throw — caller may validate inline
  guardAuthEndpoint('https://api.bilibili.com/x/space/arc/search?mid=123');
});

test('discoverVideosByUid: skips when session invalid', async () => {
  resetBilibiliRequestState();
  // Set session to known-invalid
  await validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: false } }) });
  await assert.rejects(
    () => discoverVideosByUid('123', 5),
    /Bilibili session invalid.*auth-required/,
  );
  resetBilibiliRequestState();
});

test('discoverVideosByFavorite: skips when session invalid', async () => {
  resetBilibiliRequestState();
  await validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: false } }) });
  await assert.rejects(
    () => discoverVideosByFavorite('123', 5),
    /Bilibili session invalid.*auth-required/,
  );
  resetBilibiliRequestState();
});

test('discoverDynamicsByUid: skips when session invalid', async () => {
  resetBilibiliRequestState();
  await validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: false } }) });
  await assert.rejects(
    () => discoverDynamicsByUid('123', 5),
    /Bilibili session invalid.*auth-required/,
  );
  resetBilibiliRequestState();
});

test('fetchUserPublicComments: skips when session invalid', async () => {
  resetBilibiliRequestState();
  await validateSession({ fetchJson: async () => ({ code: 0, data: { isLogin: false } }) });
  await assert.rejects(
    () => fetchUserPublicComments('123', 2),
    /Bilibili session invalid.*auth-required/,
  );
  resetBilibiliRequestState();
});

// ── SessionIdentity: UA rotation & session-sticky behavior ────────────────────

test('SessionIdentity: picks a session-sticky user agent on first ensurePicked', () => {
  const si = new SessionIdentity();
  // Before picking, defaults to USER_AGENTS[0]
  assert.equal(si.userAgent, USER_AGENTS[0]);
  assert.equal(si.platform, 'Windows');

  // Pick with deterministic randomFn — picks index 2 (Chrome 124)
  si.ensurePicked(() => 2 / USER_AGENTS.length);
  assert.ok(USER_AGENTS.includes(si.userAgent));
  assert.ok(['Windows', 'macOS'].includes(si.platform));

  // Second call is a no-op (already picked)
  const uaAfterFirst = si.userAgent;
  si.ensurePicked(() => 0.9); // different random input, should be ignored
  assert.equal(si.userAgent, uaAfterFirst);
});

test('SessionIdentity: rotate picks a new UA on block', () => {
  const si = new SessionIdentity();
  // Deterministic: pick first UA (index 0)
  si.ensurePicked(() => 0);
  const first = si.userAgent;
  assert.ok(first.length > 0);

  // Rotate to a different UA (index 3)
  si.rotate(() => 3 / USER_AGENTS.length);
  assert.notEqual(si.userAgent, first);
  assert.ok(USER_AGENTS.includes(si.userAgent));
});

test('SessionIdentity: reset clears state back to defaults', () => {
  const si = new SessionIdentity();
  si.ensurePicked(() => 0.5);
  assert.notEqual(si.userAgent, USER_AGENTS[0]);

  si.reset();
  assert.equal(si.userAgent, USER_AGENTS[0]);
  assert.equal(si.platform, 'Windows');
});

test('SessionIdentity: rotate is a no-op when BILIBILI_CRAWLER_UA env is pinned', () => {
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';
  try {
    const si = new SessionIdentity();
    si.ensurePicked(() => 0);
    const pinned = si.userAgent;
    assert.ok(pinned.includes('Firefox'));

    // Rotate should be a no-op under env override
    si.rotate(() => 0.9);
    assert.equal(si.userAgent, pinned);
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
  }
});

test('SessionIdentity: secChUa returns Chrome client-hint header', () => {
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  try {
    const si = new SessionIdentity();
    si.ensurePicked(() => 0);
    assert.equal(si.secChUa, '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="99"');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
  }
});

test('SessionIdentity: secChUa returns empty string for Firefox', () => {
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';
  try {
    const si = new SessionIdentity();
    si.ensurePicked(() => 0);
    assert.equal(si.secChUa, '');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
  }
});

test('SessionIdentity: secChUa returns Edge client-hint header', () => {
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
  try {
    const si = new SessionIdentity();
    si.ensurePicked(() => 0);
    assert.equal(si.secChUa, '"Chromium";v="126", "Microsoft Edge";v="126", "Not.A/Brand";v="99"');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
  }
});

test('SessionIdentity: ensurePicked detects macOS platform from UA', () => {
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  try {
    const si = new SessionIdentity();
    si.ensurePicked(() => 0);
    assert.equal(si.platform, 'macOS');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
  }
});

test('SessionIdentity: buildSecChUa defaults to sessionIdentity.userAgent', () => {
  resetBilibiliRequestState();
  process.env.BILIBILI_CRAWLER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  try {
    sessionIdentity.reset();
    sessionIdentity.ensurePicked(() => 0);
    const result = buildSecChUa(); // no argument — uses sessionIdentity.userAgent
    assert.equal(result, '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"');
  } finally {
    delete process.env.BILIBILI_CRAWLER_UA;
    resetBilibiliRequestState();
  }
});

test('fetchJson rotates UA on block cooldown', async () => {
  resetBilibiliRequestState();
  try {
    let now = 0;
    const seenUas = [];
    // First response: block (-352). Second response: success (code 0).
    const responses = [{ code: -352, message: '-352' }, { code: 0, data: {} }];
    const options = {
      env: {},
      config: { minDelayMs: 0, jitterMs: 0, blockCooldownMs: 100, cacheTtlMs: 0, longPauseProbability: 0 },
      nowFn: () => now,
      randomFn: () => 0,
      waitFn: async (ms) => { now += ms; },
      fetchImpl: async (_url, init) => {
        seenUas.push(init.headers['user-agent']);
        return { ok: true, json: async () => responses.shift() };
      },
    };
    // First call: triggers block cooldown + UA rotation
    await fetchJson('https://api.bilibili.com/block-test-a', 'https://www.bilibili.com/video/BVxxx/', options);
    // Second call: after cooldown, new UA is picked (sticky flag is still set from rotation)
    await fetchJson('https://api.bilibili.com/block-test-b', 'https://www.bilibili.com/video/BVxxx/', options);
    assert.equal(seenUas.length, 2);
    // Both calls happened (block didn't prevent the second request).
    // With randomFn=0, both picks use index 0 (USER_AGENTS[0] = Chrome 126).
    assert.ok(seenUas[0].includes('Chrome/126'));
    assert.ok(seenUas[1].includes('Chrome/126'));
  } finally {
    resetBilibiliRequestState();
  }
});
