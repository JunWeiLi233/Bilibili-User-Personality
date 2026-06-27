import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeTiebaHtmlResponse,
  discoverTiebaThreads,
  fetchTiebaThreadComments,
  scrapeTiebaKeyword,
  scrapeTiebaThreadUrls,
  tiebaThreadsToDiscoveryComments,
  threadFromTiebaUrl,
} from './tiebaScraper.js';

test('decodeTiebaHtmlResponse decodes GBK Tieba pages as Chinese text', () => {
  const bytes = Uint8Array.from(Buffer.from('cedeb5d0bfc9b0ae', 'hex'));
  assert.equal(decodeTiebaHtmlResponse(bytes, 'text/html; charset=gbk'), '无敌可爱');
});

test('threadFromTiebaUrl normalizes public Tieba thread URLs', () => {
  assert.deepEqual(threadFromTiebaUrl('https://c.tieba.baidu.com/p/10759170700?mo_device=1', 'sample'), {
    id: '10759170700',
    kind: 'tieba-thread',
    title: 'Tieba thread 10759170700',
    keyword: 'sample',
    sourceUrl: 'https://tieba.baidu.com/p/10759170700',
    fetchUrl: 'https://c.tieba.baidu.com/p/10759170700?mo_device=1',
  });
  assert.deepEqual(threadFromTiebaUrl('10759170700'), {
    id: '10759170700',
    kind: 'tieba-thread',
    title: 'Tieba thread 10759170700',
    keyword: '',
    sourceUrl: 'https://tieba.baidu.com/p/10759170700',
  });
  assert.equal(threadFromTiebaUrl('https://tieba.baidu.com/f?kw=x'), null);
});

test('fetchTiebaThreadComments keeps explicit mobile Tieba thread fetch URLs', async () => {
  const seenUrls = [];
  const thread = threadFromTiebaUrl('https://c.tieba.baidu.com/p/10759170700?lp=home_main_thread_pb&mo_device=1', 'sample');
  const comments = await fetchTiebaThreadComments(thread, { pages: 1 }, {
    fetchText: async (url) => {
      seenUrls.push(String(url));
      return `
        <div class="l_post" data-field='{"author":{"user_name":"mobile-user"},"content":{"post_id":11}}'>
          <div class="d_post_content j_d_post_content">移动端贴吧评论</div>
        </div>
      `;
    },
    waitFn: async () => {},
  });

  assert.equal(new URL(seenUrls[0]).hostname, 'c.tieba.baidu.com');
  assert.equal(new URL(seenUrls[0]).searchParams.get('mo_device'), '1');
  assert.equal(new URL(seenUrls[0]).searchParams.get('pn'), '1');
  assert.equal(comments[0].sourceUrl, 'https://tieba.baidu.com/p/10759170700');
  assert.equal(comments[0].message, '移动端贴吧评论');
});

test('discoverTiebaThreads fetches Tieba forum pages and normalizes thread links', async () => {
  const seen = [];
  const threads = await discoverTiebaThreads('抗压背锅', { pages: 1, limit: 2 }, {
    fetchText: async (url, referer) => {
      seen.push({ url: String(url), referer });
      return `
        <a href="/p/1234567890" title="懂的都懂节奏复盘">懂的都懂节奏复盘</a>
        <a href="https://tieba.baidu.com/p/222" title="ignored duplicate host">ignored</a>
        <a href="/p/1234567890" title="duplicate">duplicate</a>
      `;
    },
    waitFn: async () => {},
  });

  assert.equal(threads.length, 2);
  assert.equal(threads[0].id, '1234567890');
  assert.equal(threads[0].title, '懂的都懂节奏复盘');
  assert.equal(threads[0].sourceUrl, 'https://tieba.baidu.com/p/1234567890');
  assert.equal(threads[1].sourceUrl, 'https://tieba.baidu.com/p/222');
  assert.equal(seen[0].url.includes('/f?'), true);
  assert.equal(new URL(seen[0].url).searchParams.get('kw'), '抗压背锅');
  assert.equal(seen[0].referer, 'https://tieba.baidu.com/');
});

test('discoverTiebaThreads can use mobile discovery pages', async () => {
  const seen = [];
  const threads = await discoverTiebaThreads('表番', { pages: 1, limit: 1, discoveryMode: 'mobile' }, {
    fetchText: async (url) => {
      seen.push(String(url));
      return '<a href="/p/1234567890" title="表番讨论">表番讨论</a>';
    },
    waitFn: async () => {},
  });

  assert.equal(threads.length, 1);
  assert.equal(new URL(seen[0]).pathname, '/mo/q/seekcomposite');
  assert.equal(new URL(seen[0]).searchParams.get('kw'), '表番');
});

test('tiebaThreadsToDiscoveryComments converts discovered thread titles into corpus comments', () => {
  const comments = tiebaThreadsToDiscoveryComments(
    [
      {
        id: '1000',
        title: '无敌可爱是什么梗',
        sourceUrl: 'https://tieba.baidu.com/p/1000',
        keyword: '无敌可爱',
      },
      {
        id: '2000',
        title: 'Tieba thread 2000',
        sourceUrl: 'https://tieba.baidu.com/p/2000',
      },
    ],
    '无敌可爱',
  );

  assert.deepEqual(comments, [
    {
      sourceKind: 'tieba-discovery',
      sourceTitle: '无敌可爱是什么梗',
      sourceUrl: 'https://tieba.baidu.com/p/1000',
      rpid: 'tieba-discovery-1000',
      like: 0,
      ctime: 0,
      uname: '',
      mid: '',
      message: '无敌可爱是什么梗',
      platform: 'tieba',
      keyword: '无敌可爱',
    },
  ]);
});

test('fetchTiebaThreadComments extracts author text and nested post content from mobile-style html', async () => {
  const comments = await fetchTiebaThreadComments(
    { id: '1234567890', title: 'sample thread', sourceUrl: 'https://tieba.baidu.com/p/1234567890' },
    { pages: 1 },
    {
      fetchText: async () => `
        <div class="l_post" data-field='{"author":{"user_name":"老哥"},"content":{"post_id":11}}'>
          <div class="d_post_content j_d_post_content">懂的都懂，不细说了</div>
        </div>
        <div class="l_post" data-field='{"author":{"user_name":"另一个"},"content":{"post_id":12}}'>
          <cc><div>这谁能绷得住，建议查查资料</div></cc>
        </div>
      `,
      waitFn: async () => {},
    },
  );

  assert.deepEqual(
    comments.map((comment) => ({
      rpid: comment.rpid,
      uname: comment.uname,
      message: comment.message,
      sourceKind: comment.sourceKind,
      sourceUrl: comment.sourceUrl,
    })),
    [
      {
        rpid: 'tieba-1234567890-11',
        uname: '老哥',
        message: '懂的都懂，不细说了',
        sourceKind: 'tieba-thread',
        sourceUrl: 'https://tieba.baidu.com/p/1234567890',
      },
      {
        rpid: 'tieba-1234567890-12',
        uname: '另一个',
        message: '这谁能绷得住，建议查查资料',
        sourceKind: 'tieba-thread',
        sourceUrl: 'https://tieba.baidu.com/p/1234567890',
      },
    ],
  );
});

test('scrapeTiebaKeyword limits pacing and dedupes comments across discovered threads', async () => {
  const waits = [];
  const result = await scrapeTiebaKeyword('懂的都懂', {
    forumPages: 1,
    threadLimit: 2,
    threadPages: 1,
    minDelayMs: 1000,
    jitterMs: 0,
  }, {
    fetchText: async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/f?')) {
        return '<a href="/p/100" title="first">first</a><a href="/p/200" title="second">second</a>';
      }
      return `
        <div class="l_post" data-field='{"author":{"user_name":"u"},"content":{"post_id":1}}'>
          <div class="d_post_content j_d_post_content">懂的都懂</div>
        </div>
      `;
    },
    waitFn: async (ms) => {
      waits.push(ms);
    },
    randomFn: () => 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.threads.length, 2);
  assert.equal(result.comments.length, 1);
  assert.equal(result.commentText, '懂的都懂');
  assert.equal(waits.every((ms) => ms >= 1000), true);
  assert.equal(waits.length >= 2, true);
});

test('scrapeTiebaThreadUrls fetches explicit threads with pacing and deduped comments', async () => {
  const waits = [];
  const result = await scrapeTiebaThreadUrls(
    ['https://c.tieba.baidu.com/p/1000?mo_device=1', 'https://tieba.baidu.com/p/1000', 'https://tieba.baidu.com/p/2000'],
    {
      pages: 1,
      minDelayMs: 5000,
      jitterMs: 0,
    },
    {
      fetchText: async (url) => `
        <div class="l_post" data-field='{"author":{"user_name":"u"},"content":{"post_id":${String(url).includes('2000') ? 2 : 1}}}'>
          <div class="d_post_content j_d_post_content">${String(url).includes('2000') ? '第二个公开帖子' : '第一个公开帖子'}</div>
        </div>
      `,
      waitFn: async (ms) => waits.push(ms),
      randomFn: () => 0,
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.threads.map((thread) => thread.id), ['1000', '2000']);
  assert.deepEqual(result.comments.map((comment) => comment.message), ['第一个公开帖子', '第二个公开帖子']);
  assert.deepEqual(waits, [5000]);
});

test('scrapeTiebaThreadUrls records safety block warnings and cools down', async () => {
  const waits = [];
  const result = await scrapeTiebaThreadUrls(
    ['https://tieba.baidu.com/p/1000'],
    {
      pages: 1,
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 1234,
    },
    {
      fetchText: async () => {
        const error = new Error('Tieba safety verification page returned');
        error.tiebaBlocked = true;
        throw error;
      },
      waitFn: async (ms) => waits.push(ms),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.comments.length, 0);
  assert.match(result.warnings.join('\n'), /safety verification/i);
  assert.deepEqual(waits, [1234]);
});

test('scrapeTiebaKeyword returns a warning when discovery exceeds the wall-clock timeout', async () => {
  const seenSignals = [];
  const result = await scrapeTiebaKeyword('懂的都懂', { overallTimeoutMs: 10 }, {
    fetchText: async (_url, _referer, options = {}) => {
      seenSignals.push(options.signal);
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    waitFn: async () => {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.threads, []);
  assert.deepEqual(result.comments, []);
  assert.match(result.warnings.join('\n'), /timed out/i);
  assert.equal(seenSignals.length, 1);
  assert.equal(seenSignals[0].aborted, true);
});

test('scrapeTiebaKeyword treats Baidu safety verification pages as blocked and cools down', async () => {
  const waits = [];
  const result = await scrapeTiebaKeyword('sample', {
    blockCooldownMs: 1234,
    minDelayMs: 0,
    jitterMs: 0,
  }, {
    fetchText: async () => `
      <!DOCTYPE html>
      <html><head><title>百度安全验证</title></head>
      <body><script>window.BIOC_OPTIONS={subid:'tb_pc_frs_bfe'}</script></body></html>
    `,
    waitFn: async (ms) => {
      waits.push(ms);
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.threads, []);
  assert.deepEqual(result.comments, []);
  assert.match(result.warnings.join('\n'), /safety verification/i);
  assert.deepEqual(waits, [1234]);
});

test('scrapeTiebaKeyword can keep discovery titles when thread pages are blocked', async () => {
  const result = await scrapeTiebaKeyword(
    '无敌可爱',
    {
      forumPages: 1,
      threadLimit: 1,
      threadPages: 1,
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      includeDiscoveryTitles: true,
    },
    {
      fetchText: async (url) => {
        const textUrl = String(url);
        // Discovery URLs: desktop /f? or mobile /mo/q/seekcomposite
        if (textUrl.includes('/f?') || textUrl.includes('/mo/q/seekcomposite')) {
          return '<a href="/mo/q/m?kz=1000&from_search=1"><span class="se_thread_title">无敌可爱是什么梗</span></a>';
        }
        // Thread page URLs: desktop /p/<id> or mobile /mo/q/m?kz=<id>
        // Both get blocked → titles still appear via includeDiscoveryTitles
        const error = new Error('Tieba safety verification page returned');
        error.tiebaBlocked = true;
        throw error;
      },
      waitFn: async () => {},
    },
  );

  assert.equal(result.threads.length, 1);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].message, '无敌可爱是什么梗');
  assert.match(result.warnings.join('\n'), /safety verification/i);
});

test('scrapeTiebaKeyword discoveryTitlesOnly avoids fetching thread pages', async () => {
  const seenUrls = [];
  const result = await scrapeTiebaKeyword(
    '无敌可爱',
    {
      forumPages: 1,
      threadLimit: 1,
      threadPages: 1,
      minDelayMs: 0,
      jitterMs: 0,
      discoveryTitlesOnly: true,
      discoveryMode: 'mobile',
    },
    {
      fetchText: async (url) => {
        seenUrls.push(String(url));
        return '<a href="/mo/q/m?kz=1000&from_search=1"><span class="se_thread_title">无敌可爱是什么梗</span></a>';
      },
      waitFn: async () => {},
    },
  );

  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].sourceKind, 'tieba-discovery');
  assert.equal(seenUrls.length, 1);
  assert.equal(seenUrls[0].includes('/mo/q/seekcomposite'), true);
});
