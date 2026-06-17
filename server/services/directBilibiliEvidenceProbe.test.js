import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBilibiliWebHeaders,
  buildBilibiliReplyUrl,
  buildBilibiliReplyPageUrl,
  buildBilibiliReplyThreadUrl,
  boundedProbeVideosPerQuery,
  buildEvidenceSourceVideosForActions,
  buildFreshEvidenceEntriesFromComments,
  buildBilibiliSearchUrls,
  buildBilibiliViewUrl,
  collectScannedProbeVideoKeys,
  buildProbeCorpus,
  collectBilibiliDanmakuMessages,
  collectBilibiliReplyMessages,
  extractBilibiliVideoRefs,
  filterUnscannedProbeVideos,
  isAnalyzableProbeMessage,
  makeSyntheticBilibiliCookie,
  nextReplyCursor,
  probeSearchNeedles,
  probeVideoKey,
  rankProbeVideosForAction,
  scoreProbeVideoForAction,
} from './directBilibiliEvidenceProbe.js';

test('collectBilibiliReplyMessages flattens nested replies with source metadata', () => {
  const comments = collectBilibiliReplyMessages(
    [
      {
        mid: 100,
        content: { message: 'top level comment' },
        replies: [{ member: { mid: 200 }, content: { message: 'nested comment' } }],
      },
    ],
    { bvid: 'BVdirect' },
  );

  assert.deepEqual(comments, [
    {
      message: 'top level comment',
      uid: '100',
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVdirect/',
    },
    {
      message: 'nested comment',
      uid: '200',
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVdirect/',
    },
  ]);
});

test('collectBilibiliReplyMessages uses public av URL for aid-only videos', () => {
  const comments = collectBilibiliReplyMessages(
    [{ mid: 100, content: { message: 'aid only comment' } }],
    { aid: '12345' },
  );

  assert.equal(comments[0].source, 'Bilibili public direct comment probe: https://www.bilibili.com/video/av12345/');
});

test('collectBilibiliDanmakuMessages extracts XML danmaku with source metadata', () => {
  const comments = collectBilibiliDanmakuMessages(
    '<i><d p="1,1,25,16777215,1,0,0,0">你没见过不代表没有</d><d>查查资料</d></i>',
    { bvid: 'BVdm' },
  );

  assert.deepEqual(comments, [
    {
      message: '你没见过不代表没有',
      uid: 'BVdm',
      source: 'Bilibili public direct danmaku probe: https://www.bilibili.com/video/BVdm/',
    },
    {
      message: '查查资料',
      uid: 'BVdm',
      source: 'Bilibili public direct danmaku probe: https://www.bilibili.com/video/BVdm/',
    },
  ]);
});

test('collectBilibiliDanmakuMessages decodes XML entities and skips blank messages', () => {
  const comments = collectBilibiliDanmakuMessages('<d> 查&amp;查资料 </d><d> </d>', { bvid: 'BVxml' });

  assert.deepEqual(comments, [
    {
      message: '查&查资料',
      uid: 'BVxml',
      source: 'Bilibili public direct danmaku probe: https://www.bilibili.com/video/BVxml/',
    },
  ]);
});

test('collectBilibiliDanmakuMessages uses public av URL for aid-only videos', () => {
  const comments = collectBilibiliDanmakuMessages('<d>aid only danmaku</d>', { aid: '12345' });

  assert.equal(comments[0].source, 'Bilibili public direct danmaku probe: https://www.bilibili.com/video/av12345/');
});

test('buildFreshEvidenceEntriesFromComments matches weak dictionary terms and skips duplicates', () => {
  const dictionary = {
    entries: [
      {
        term: '查查资料',
        family: 'evidence',
        meaning: 'asks for verification',
        evidenceCount: 1,
        evidenceSamples: ['旧样本查查资料'],
      },
      {
        term: '这还用问',
        family: 'evasion',
        evidenceCount: 3,
      },
    ],
  };
  const comments = [
    { message: '旧样本查查资料', source: 'duplicate' },
    { message: '建议你先查查资料再说', source: 'fresh source', uid: '42' },
    { message: '这还用问吗', source: 'already complete' },
  ];

  const entries = buildFreshEvidenceEntriesFromComments(dictionary, comments);

  assert.deepEqual(entries, [
    {
      term: '查查资料',
      family: 'evidence',
      meaning: 'asks for verification',
      evidence: ['建议你先查查资料再说'],
      evidenceSamples: ['建议你先查查资料再说'],
      evidenceSources: [
        {
          source: 'fresh source',
          uid: '42',
          sample: '建议你先查查资料再说',
        },
      ],
    },
  ]);
});

test('buildFreshEvidenceEntriesFromComments can refresh explicit strict-audit targets with full stored evidence', () => {
  const entries = buildFreshEvidenceEntriesFromComments(
    {
      entries: [
        {
          term: '查查资料',
          family: 'evidence',
          meaning: 'asks for verification',
          evidenceCount: 3,
          evidenceSamples: ['旧样本查查资料'],
        },
      ],
    },
    [{ message: '建议先查查资料再评论', source: 'fresh source', uid: '42' }],
    { targetEvidence: 3, targetTerms: ['查查资料'] },
  );

  assert.deepEqual(entries, [
    {
      term: '查查资料',
      family: 'evidence',
      meaning: 'asks for verification',
      evidence: ['建议先查查资料再评论'],
      evidenceSamples: ['建议先查查资料再评论'],
      evidenceSources: [
        {
          source: 'fresh source',
          uid: '42',
          sample: '建议先查查资料再评论',
        },
      ],
    },
  ]);
});

test('buildFreshEvidenceEntriesFromComments refreshes comment-backed weak entries with full raw evidence', () => {
  const entries = buildFreshEvidenceEntriesFromComments(
    {
      entries: [
        {
          term: '上下文词',
          family: 'attack',
          meaning: 'context-heavy term',
          evidenceCount: 3,
          evidenceSources: [
            { source: 'search-discovered video context', sample: 'Bilibili video context: 上下文词' },
            { source: 'search-discovered video context', sample: 'Bilibili public video title: 上下文词' },
            { source: 'Bilibili local corpus', sample: '评论里说上下文词' },
          ],
        },
      ],
    },
    [{ message: '新的评论上下文词证据', source: 'fresh source', uid: '43' }],
    { targetEvidence: 3, requireCommentBackedEvidence: true },
  );

  assert.deepEqual(entries, [
    {
      term: '上下文词',
      family: 'attack',
      meaning: 'context-heavy term',
      evidence: ['新的评论上下文词证据'],
      evidenceSamples: ['新的评论上下文词证据'],
      evidenceSources: [
        {
          source: 'fresh source',
          uid: '43',
          sample: '新的评论上下文词证据',
        },
      ],
    },
  ]);
});

test('buildFreshEvidenceEntriesFromComments accepts generated evidence aliases for direct probe comments', () => {
  const entries = buildFreshEvidenceEntriesFromComments(
    {
      entries: [
        {
          term: '\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f',
          family: 'absolutes',
          meaning: 'sarcastic disbelief',
          evidenceCount: 1,
          evidenceSamples: ['\u65e7\u6837\u672c\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f'],
        },
      ],
    },
    [
      {
        message: '\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a\uff0c\u5f39\u5e55\u5168\u7b11\u75af\u4e86',
        source: 'fresh source',
        uid: '44',
      },
    ],
  );

  assert.deepEqual(entries, [
    {
      term: '\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f',
      family: 'absolutes',
      meaning: 'sarcastic disbelief',
      evidence: ['\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a\uff0c\u5f39\u5e55\u5168\u7b11\u75af\u4e86'],
      evidenceSamples: ['\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a\uff0c\u5f39\u5e55\u5168\u7b11\u75af\u4e86'],
      evidenceSources: [
        {
          source: 'fresh source',
          uid: '44',
          sample: '\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a\uff0c\u5f39\u5e55\u5168\u7b11\u75af\u4e86',
        },
      ],
    },
  ]);
});

test('probeSearchNeedles drops generic comment-search scaffolding', () => {
  assert.deepEqual(probeSearchNeedles({ term: '超绝无语', query: '超绝无语 评论回复' }), ['超绝无语']);
  assert.deepEqual(probeSearchNeedles({ term: '倒退10年', query: 'attack 倒退10年 评论区 热评' }), ['倒退10年']);
  assert.deepEqual(probeSearchNeedles({ term: '查查资料', query: '查查资料、评论区、热评' }), ['查查资料']);
});

test('rankProbeVideosForAction prefers exact weak-term title matches', () => {
  const videos = [
    { bvid: 'BVnoise', title: '热门回复合集' },
    { bvid: 'BVexact', title: '超绝无语的一集' },
    { bvid: 'BVother', title: '普通评论区反应' },
  ];

  assert.equal(scoreProbeVideoForAction(videos[0], { term: '超绝无语', query: '超绝无语 评论回复' }), 0);
  assert.deepEqual(
    rankProbeVideosForAction(videos, { term: '超绝无语', query: '超绝无语 评论回复' }).map((video) => video.bvid),
    ['BVexact', 'BVnoise', 'BVother'],
  );
});

test('buildBilibiliWebHeaders emits browser-like headers and optional cookies', () => {
  const headers = buildBilibiliWebHeaders('https://search.bilibili.com/all?keyword=x', { cookie: 'a=b' });

  assert.equal(headers.origin, 'https://search.bilibili.com');
  assert.equal(headers.cookie, 'a=b');
  assert.match(headers['user-agent'], /Chrome/);
  assert.equal(headers['sec-fetch-site'], 'same-site');
});

test('buildBilibiliSearchUrls creates bounded paginated video search URLs', () => {
  const urls = buildBilibiliSearchUrls('查查资料 B站评论', { pages: 3, pageSize: 8 });

  assert.equal(urls.length, 3);
  assert.equal(urls[0].searchParams.get('search_type'), 'video');
  assert.equal(urls[0].searchParams.get('keyword'), '查查资料 B站评论');
  assert.equal(urls[0].searchParams.get('page'), '1');
  assert.equal(urls[1].searchParams.get('page'), '2');
  assert.equal(urls[2].searchParams.get('page_size'), '8');
});

test('boundedProbeVideosPerQuery allows source-only direct probes with zero search videos', () => {
  assert.equal(boundedProbeVideosPerQuery('0', 5), 0);
  assert.equal(boundedProbeVideosPerQuery('-1', 5), 0);
  assert.equal(boundedProbeVideosPerQuery('25', 5), 20);
  assert.equal(boundedProbeVideosPerQuery('bad', 5), 5);
});

test('buildBilibiliViewUrl supports BVID and aid lookups', () => {
  assert.equal(buildBilibiliViewUrl({ bvid: 'BVlookup' }).toString(), 'https://api.bilibili.com/x/web-interface/view?bvid=BVlookup');
  assert.equal(buildBilibiliViewUrl({ aid: '123' }).toString(), 'https://api.bilibili.com/x/web-interface/view?aid=123');
  assert.equal(buildBilibiliViewUrl({}), null);
});

test('buildBilibiliReplyUrl requires aid and bounds page size', () => {
  const url = buildBilibiliReplyUrl({ aid: '123' }, 2, 100);

  assert.equal(url.searchParams.get('type'), '1');
  assert.equal(url.searchParams.get('oid'), '123');
  assert.equal(url.searchParams.get('next'), '2');
  assert.equal(url.searchParams.get('ps'), '50');
  assert.equal(buildBilibiliReplyUrl({ bvid: 'BVmissingAid' }), null);
});

test('buildBilibiliReplyPageUrl builds legacy page-number reply URLs', () => {
  const url = buildBilibiliReplyPageUrl({ aid: '456' }, 0, 100);

  assert.equal(url.pathname, '/x/v2/reply');
  assert.equal(url.searchParams.get('oid'), '456');
  assert.equal(url.searchParams.get('sort'), '2');
  assert.equal(url.searchParams.get('pn'), '1');
  assert.equal(url.searchParams.get('ps'), '50');
  assert.equal(buildBilibiliReplyPageUrl({}), null);
});

test('buildBilibiliReplyThreadUrl builds root reply URLs', () => {
  const url = buildBilibiliReplyThreadUrl({ aid: '789', rootRpid: '456' }, undefined, 2, 100);

  assert.equal(url.pathname, '/x/v2/reply/reply');
  assert.equal(url.searchParams.get('oid'), '789');
  assert.equal(url.searchParams.get('root'), '456');
  assert.equal(url.searchParams.get('pn'), '2');
  assert.equal(url.searchParams.get('ps'), '50');
  assert.equal(buildBilibiliReplyThreadUrl({ aid: '789' }), null);
});

test('nextReplyCursor follows Bilibili reply cursor end and next values', () => {
  assert.equal(nextReplyCursor({ data: { cursor: { is_end: true, next: 4 } } }, 3), null);
  assert.equal(nextReplyCursor({ data: { cursor: { is_end: false, next: 4 } } }, 3), 4);
  assert.equal(nextReplyCursor({ data: { cursor: { is_end: false, next: 0 } } }, 3), 4);
});

test('extractBilibiliVideoRefs extracts and dedupes BV and av ids from source text', () => {
  const refs = extractBilibiliVideoRefs(
    'https://www.bilibili.com/video/BV1abc/ and http://www.bilibili.com/video/av123 plus https://www.bilibili.com/video/BV1abc/',
  );

  assert.deepEqual(refs, [{ bvid: 'BV1abc' }, { aid: '123' }]);
});

test('extractBilibiliVideoRefs keeps reply roots for precise source rescans', () => {
  const refs = extractBilibiliVideoRefs(
    'Bilibili public reply detail probe: https://www.bilibili.com/video/av116663559131570/?reply=301234384593',
  );

  assert.deepEqual(refs, [{ aid: '116663559131570', rootRpid: '301234384593' }]);
});

test('probeVideoKey normalizes BVID and aid video identities', () => {
  assert.equal(probeVideoKey({ bvid: 'BVsource1/' }), 'bvid:BVsource1');
  assert.equal(probeVideoKey({ aid: 'av456' }), 'aid:456');
  assert.equal(probeVideoKey({}), '');
});

test('collectScannedProbeVideoKeys combines run videos and comment source refs', () => {
  const keys = collectScannedProbeVideoKeys({
    comments: [
      {
        source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVcomment/',
      },
    ],
    runs: [
      {
        videos: [{ bvid: 'BVrun' }, { key: 'aid:123' }],
      },
    ],
  });

  assert.deepEqual([...keys].sort(), ['aid:123', 'bvid:BVcomment', 'bvid:BVrun']);
});

test('filterUnscannedProbeVideos drops already scanned and duplicate videos', () => {
  const videos = filterUnscannedProbeVideos(
    [{ bvid: 'BVold' }, { bvid: 'BVfresh' }, { bvid: 'BVfresh' }, { aid: '321' }],
    new Set(['bvid:BVold']),
  );

  assert.deepEqual(videos, [{ bvid: 'BVfresh' }, { aid: '321' }]);
});

test('buildEvidenceSourceVideosForActions returns bounded existing source videos by term', () => {
  const videosByTerm = buildEvidenceSourceVideosForActions(
    {
      entries: [
        {
          term: 'rare-term',
          evidenceSources: [
            { source: 'https://www.bilibili.com/video/BVsource1/ https://www.bilibili.com/video/av456' },
            { source: 'https://www.bilibili.com/video/BVsource2/' },
          ],
        },
        {
          term: 'other-term',
          evidenceSources: [{ source: 'https://www.bilibili.com/video/BVother/' }],
        },
      ],
    },
    [{ term: 'rare-term', query: 'rare-term comments' }],
    { maxPerAction: 2 },
  );

  assert.deepEqual(videosByTerm.get('rare-term'), [
    {
      bvid: 'BVsource1',
      title: 'existing evidence source for rare-term',
    },
    {
      aid: '456',
      title: 'existing evidence source for rare-term',
    },
  ]);
  assert.equal(videosByTerm.has('other-term'), false);
});

test('buildEvidenceSourceVideosForActions recovers source videos from matching corpus samples', () => {
  const videosByTerm = buildEvidenceSourceVideosForActions(
    {
      entries: [
        {
          term: 'uid-only-term',
          evidenceSamples: ['corpus backed sample'],
          evidenceSources: [{ source: 'Popular video comments UID 123 (1 comments from 1 videos)', sample: 'corpus backed sample' }],
        },
      ],
    },
    [{ term: 'uid-only-term', query: 'uid-only-term comments' }],
    {
      maxPerAction: 2,
      corpus: {
        comments: [
          {
            message: 'corpus backed sample',
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVfromCorpus/',
          },
          {
            message: 'corpus backed sample',
            source: 'Bilibili public reply detail probe: https://www.bilibili.com/video/av987654/?reply=112233',
          },
        ],
      },
    },
  );

  assert.deepEqual(videosByTerm.get('uid-only-term'), [
    {
      aid: '987654',
      rootRpid: '112233',
      title: 'existing evidence source for uid-only-term',
    },
  ]);
});

test('makeSyntheticBilibiliCookie creates stable browser cookie names', () => {
  const cookie = makeSyntheticBilibiliCookie(() => 0.5, 1700000000000);

  assert.match(cookie, /buvid3=/);
  assert.match(cookie, /buvid4=/);
  assert.match(cookie, /b_nut=1700000000/);
  assert.match(cookie, /_uuid=/);
  assert.match(cookie, /b_lsid=/);
});

test('isAnalyzableProbeMessage keeps Han speech and rejects non-lexical danmaku', () => {
  assert.equal(isAnalyzableProbeMessage('\u5f88\u6709\u9053\u7406'), true);
  assert.equal(isAnalyzableProbeMessage('666'), false);
  assert.equal(isAnalyzableProbeMessage('test'), false);
});

test('buildProbeCorpus appends deduped analyzable comments with run metadata', () => {
  const corpus = buildProbeCorpus(
    {
      version: 1,
      comments: [
        {
          message: '\u5df2\u6709\u8bc4\u8bba',
          source: 'old source',
          uid: '1',
        },
        {
          message: '666',
          source: 'old non lexical',
          uid: 'skip',
        },
      ],
      runs: [{ at: 'old' }],
    },
    [
      { message: '\u5df2\u6709\u8bc4\u8bba', source: 'duplicate source', uid: '2' },
      { message: '\u65b0\u6536\u96c6\u8bc4\u8bba', source: 'new source', uid: '3' },
      { message: 'test', source: 'new non lexical', uid: 'skip' },
    ],
    {
      at: 'now',
      actions: [{ term: '查查资料', query: '查查资料 B站评论' }],
      warnings: ['one warning'],
    },
  );

  assert.deepEqual(corpus, {
    version: 1,
    comments: [
      {
        message: '\u5df2\u6709\u8bc4\u8bba',
        source: 'old source',
        uid: '1',
      },
      {
        message: '\u65b0\u6536\u96c6\u8bc4\u8bba',
        source: 'new source',
        uid: '3',
      },
    ],
    runs: [
      { at: 'old' },
      {
        at: 'now',
        actions: [{ term: '查查资料', query: '查查资料 B站评论' }],
        warnings: ['one warning'],
        commentsCollected: 3,
        commentsAdded: 1,
      },
    ],
    updatedAt: 'now',
  });
});
