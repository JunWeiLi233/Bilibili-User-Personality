import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeakTermSet, findLocalCorpusEvidenceEntries, flattenBilibiliCommentCorpus } from './localCorpusEvidence.js';

test('flattenBilibiliCommentCorpus reads uid-discovery comment maps into source-backed comments', () => {
  const comments = flattenBilibiliCommentCorpus({
    100: [
      { message: '懂的都懂，不展开了', uname: 'u1', bvid: 'BVabc' },
      { message: '', uname: 'u2', bvid: 'BVempty' },
    ],
  });

  assert.deepEqual(comments, [
    {
      message: '懂的都懂，不展开了',
      platform: 'bilibili',
      source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVabc/',
      uid: 'BVabc',
      uname: 'u1',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads AICU user database comments and danmaku', () => {
  const comments = flattenBilibiliCommentCorpus({
    users: {
      123: {
        comments: [{ message: '百度一下就知道了', oid: '9988' }],
        danmaku: [{ content: '这谁能绷得住', oid: '7766' }],
      },
    },
  });

  assert.deepEqual(comments, [
    {
      message: '百度一下就知道了',
      platform: 'bilibili',
      source: 'Bilibili local AICU corpus: https://www.bilibili.com/video/av9988/',
      uid: '123',
      uname: '',
    },
    {
      message: '这谁能绷得住',
      platform: 'bilibili',
      source: 'Bilibili local AICU danmaku corpus: https://www.bilibili.com/video/av7766/',
      uid: '123',
      uname: '',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads uid progress _uidComments maps', () => {
  const comments = flattenBilibiliCommentCorpus({
    scannedBvids: [],
    _uidComments: {
      42: [
        { message: 'alpha phrase appears here', uname: 'tester', bvid: 'BVprogress' },
        { message: '', uname: 'empty', bvid: 'BVempty' },
      ],
    },
  });

  assert.deepEqual(comments, [
    {
      message: 'alpha phrase appears here',
      platform: 'bilibili',
      source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVprogress/',
      uid: 'BVprogress',
      uname: 'tester',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads scraped user database commentText fields', () => {
  const comments = flattenBilibiliCommentCorpus({
    users: {
      860: {
        uid: '860',
        uname: 'sample-user',
        commentText: 'first comment\nsecond comment',
        bvids: ['BVone', 'BVtwo'],
      },
    },
  });

  assert.deepEqual(comments, [
    {
      message: 'first comment',
      platform: 'bilibili',
      source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVone/',
      uid: '860',
      uname: 'sample-user',
    },
    {
      message: 'second comment',
      platform: 'bilibili',
      source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVtwo/',
      uid: '860',
      uname: 'sample-user',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads scraped user database combinedText when commentText is absent', () => {
  const comments = flattenBilibiliCommentCorpus({
    users: {
      861: {
        uid: '861',
        uname: 'combined-user',
        combinedText: 'combined first\ncombined second',
        bvids: ['BVcombined'],
      },
    },
  });

  assert.deepEqual(comments, [
    {
      message: 'combined first',
      platform: 'bilibili',
      source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVcombined/',
      uid: '861',
      uname: 'combined-user',
    },
    {
      message: 'combined second',
      platform: 'bilibili',
      source: 'Bilibili local scraped user corpus',
      uid: '861',
      uname: 'combined-user',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads saved Tieba keyword corpus comments', () => {
  const comments = flattenBilibiliCommentCorpus({
    version: 1,
    runs: [
      {
        at: '2026-06-17T00:00:00.000Z',
        results: [
          {
            query: '查查资料',
            comments: [
              {
                message: '建议你先查查资料',
                sourceUrl: 'https://tieba.baidu.com/p/123',
                uname: 'tieba-user',
                platform: 'tieba',
              },
              { message: '' },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(comments, [
    {
      message: '建议你先查查资料',
      platform: 'tieba',
      source: 'Tieba public thread scan: https://tieba.baidu.com/p/123',
      uid: '',
      uname: 'tieba-user',
    },
  ]);
});

test('flattenBilibiliCommentCorpus keeps top-level direct probe comments when runs are present', () => {
  const comments = flattenBilibiliCommentCorpus({
    version: 1,
    comments: [
      {
        message: '直接探测评论',
        source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/',
        uid: '123',
      },
    ],
    runs: [{ at: '2026-06-17T00:00:00.000Z', commentsCollected: 1 }],
  });

  assert.deepEqual(comments, [
    {
      message: '直接探测评论',
      platform: 'bilibili',
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/',
      uid: '123',
      uname: '',
    },
  ]);
});

test('flattenBilibiliCommentCorpus reads plain text comment arrays', () => {
  const comments = flattenBilibiliCommentCorpus(['查查资料再说', '', '这谁能绷得住']);

  assert.deepEqual(comments, [
    {
      message: '查查资料再说',
      platform: 'bilibili',
      source: 'Bilibili local text corpus',
      uid: '',
      uname: '',
    },
    {
      message: '这谁能绷得住',
      platform: 'bilibili',
      source: 'Bilibili local text corpus',
      uid: '',
      uname: '',
    },
  ]);
});

test('buildWeakTermSet selects entries below target evidence', () => {
  const weak = buildWeakTermSet(
    {
      entries: [
        { term: '懂的都懂', family: 'evasion', evidenceCount: 2 },
        { term: '查查资料', family: 'evidence', evidenceCount: 3 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.deepEqual([...weak.keys()], ['懂的都懂']);
});

test('buildWeakTermSet keeps explicit strict-audit targets even when stored evidence is full', () => {
  const weak = buildWeakTermSet(
    {
      entries: [
        { term: '懂的都懂', family: 'evasion', evidenceCount: 3 },
        { term: '查查资料', family: 'evidence', evidenceCount: 3 },
      ],
    },
    { targetEvidence: 3, targetTerms: ['懂的都懂'] },
  );

  assert.deepEqual([...weak.keys()], ['懂的都懂']);
});

test('buildWeakTermSet uses comment-backed evidence counts in strict mode', () => {
  const weak = buildWeakTermSet(
    {
      entries: [
        {
          term: '上下文词',
          family: 'attack',
          evidenceCount: 3,
          evidenceSamples: [
            'Bilibili video context: 上下文词',
            'Bilibili public video title: 上下文词',
            '普通样本上下文词',
          ],
          evidenceSources: [
            { source: 'search-discovered video context', sample: 'Bilibili video context: 上下文词' },
            { source: 'search-discovered video context', sample: 'Bilibili public video title: 上下文词' },
            { source: 'Bilibili local corpus', sample: '普通样本上下文词' },
          ],
        },
        {
          term: '充足评论词',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            { source: 'Bilibili local corpus', sample: '充足评论词一' },
            { source: 'Bilibili local corpus', sample: '充足评论词二' },
            { source: 'Bilibili local corpus', sample: '充足评论词三' },
          ],
        },
      ],
    },
    { targetEvidence: 3, requireCommentBackedEvidence: true },
  );

  assert.deepEqual([...weak.keys()], ['上下文词']);
});

test('findLocalCorpusEvidenceEntries creates merge-ready entries only for weak terms with fresh samples', () => {
  const dictionary = {
    entries: [
      {
        term: '懂的都懂',
        family: 'evasion',
        meaning: '暗示式回避说明',
        evidenceCount: 1,
        evidenceSamples: ['旧样本懂的都懂'],
      },
      {
        term: '查查资料',
        family: 'evidence',
        meaning: '要求查证',
        evidenceCount: 3,
      },
    ],
  };
  const comments = [
    {
      message: '这事懂的都懂，不展开了',
      source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV1/',
      uid: 'BV1',
    },
    {
      message: '旧样本懂的都懂',
      source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV2/',
      uid: 'BV2',
    },
    {
      message: '建议你先查查资料',
      source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV3/',
      uid: 'BV3',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, { targetEvidence: 3, maxSamplesPerTerm: 2 });

  assert.deepEqual(entries, [
    {
      term: '懂的都懂',
      family: 'evasion',
      meaning: '暗示式回避说明',
      evidence: ['这事懂的都懂，不展开了'],
      evidenceSamples: ['这事懂的都懂，不展开了'],
      evidenceSources: [
        {
          source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV1/',
          uid: 'BV1',
          sample: '这事懂的都懂，不展开了',
        },
      ],
    },
  ]);
});

test('findLocalCorpusEvidenceEntries backfills source metadata for existing unsourced samples', () => {
  const dictionary = {
    entries: [
      {
        term: '彻底绷不住了',
        family: 'absolutes',
        meaning: '完全破防或笑到无法保持冷静',
        evidenceCount: 3,
        evidenceSamples: ['看到你这，彻底绷不住了'],
        evidenceSources: [],
      },
    ],
  };
  const comments = [
    {
      message: '看到你这，彻底绷不住了',
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1/',
      uid: 'BV1',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, {
    targetEvidence: 3,
    requireCommentBackedEvidence: true,
  });

  assert.deepEqual(entries, [
    {
      term: '彻底绷不住了',
      family: 'absolutes',
      meaning: '完全破防或笑到无法保持冷静',
      evidence: ['看到你这，彻底绷不住了'],
      evidenceSamples: ['看到你这，彻底绷不住了'],
      evidenceSources: [
        {
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1/',
          uid: 'BV1',
          sample: '看到你这，彻底绷不住了',
        },
      ],
    },
  ]);
});

test('findLocalCorpusEvidenceEntries backfills recoverable video URLs for generic existing sources', () => {
  const dictionary = {
    entries: [
      {
        term: '\u5927\u53a8',
        family: 'attack',
        meaning: 'needs source URL recovery',
        evidenceCount: 1,
        evidenceSamples: ['\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8'],
        evidenceSources: [
          {
            source: 'Popular video comments UID 123 (1 comments from 1 videos)',
            uid: '123',
            sample: '\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8',
          },
        ],
      },
    ],
  };
  const comments = [
    {
      message: '\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8',
      source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVsourceUrl/',
      uid: '123',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, {
    targetEvidence: 3,
    requireCommentBackedEvidence: true,
  });

  assert.deepEqual(entries, [
    {
      term: '\u5927\u53a8',
      family: 'attack',
      meaning: 'needs source URL recovery',
      evidence: ['\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8'],
      evidenceSamples: ['\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8'],
      evidenceSources: [
        {
          source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVsourceUrl/',
          uid: '123',
          sample: '\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8',
        },
      ],
    },
  ]);
});

test('findLocalCorpusEvidenceEntries prefers slang-context samples over literal mentions', () => {
  const dictionary = {
    entries: [
      {
        term: '\u5927\u53a8',
        family: 'attack',
        meaning: '\u8bbd\u523a\u5f39\u5e55\u4ee5\u4e13\u4e1a\u5927\u53a8\u81ea\u5c45',
        evidenceCount: 1,
      },
    ],
  };
  const comments = [
    {
      message: '\u8fd9\u662f\u4e00\u4f4d\u5f88\u6709\u540d\u7684\u5927\u53a8',
      source: 'Bilibili local corpus',
    },
    {
      message: '\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8',
      source: 'Bilibili local corpus',
    },
    {
      message: '\u8ba9\u5f39\u5e55\u5927\u53a8\u4e24\u5c0f\u65f6\u505a\u83dc\u53bb\u6bd4\u8d5b\u5c31\u884c\u4e86',
      source: 'Bilibili local corpus',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, { targetEvidence: 3, maxSamplesPerTerm: 2 });

  assert.deepEqual(new Set(entries[0].evidenceSamples), new Set([
    '\u8ba9\u5f39\u5e55\u5927\u53a8\u4e24\u5c0f\u65f6\u505a\u83dc\u53bb\u6bd4\u8d5b\u5c31\u884c\u4e86',
    '\u4e00\u7fa4\u5403\u5916\u5356\u7684\u9510\u8bc4\u5927\u53a8',
  ]));
  assert.equal(entries[0].evidenceSamples.includes('\u8fd9\u662f\u4e00\u4f4d\u5f88\u6709\u540d\u7684\u5927\u53a8'), false);
});

test('findLocalCorpusEvidenceEntries uses generated evidence aliases for weak terms', () => {
  const dictionary = {
    entries: [
      {
        term: '\u90fd\u8bf4\u516b\u767e\u904d\u4e86',
        family: 'absolutes',
        meaning: '\u7528\u8de8\u5f20\u6b21\u6570\u5f3a\u8c03\u4e00\u4e2a\u8bf4\u6cd5\u5df2\u88ab\u53cd\u590d\u8bf4\u660e',
        evidenceCount: 1,
        evidenceSamples: ['\u90fd\u8bf4\u516b\u767e\u904d\u4e86'],
        evidenceSources: [{ source: 'Bilibili local corpus', sample: '\u90fd\u8bf4\u516b\u767e\u904d\u4e86' }],
      },
    ],
  };
  const comments = [
    {
      message: '\u90fd\u8bf4\u516b\u767e\u904d\u4e86',
      source: 'Bilibili local corpus',
    },
    {
      message: '\u4e0d\u662f\u90fd\u8bf4\u516b\u767e\u904d\u4e86\u5417\uff0c\u600e\u4e48\u8fd8\u5728\u95ee',
      source: 'Bilibili local corpus',
    },
    {
      message: '\u90fd\u8bf4\u516b\u767e\u904d\uff0c\u8fd9\u4e2a\u7248\u672c\u5c31\u662f\u4e0d\u4e00\u6837',
      source: 'Bilibili local corpus',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, {
    targetEvidence: 3,
    maxSamplesPerTerm: 3,
    requireCommentBackedEvidence: true,
  });

  assert.deepEqual(new Set(entries[0].evidenceSamples), new Set([
    '\u4e0d\u662f\u90fd\u8bf4\u516b\u767e\u904d\u4e86\u5417\uff0c\u600e\u4e48\u8fd8\u5728\u95ee',
    '\u90fd\u8bf4\u516b\u767e\u904d\uff0c\u8fd9\u4e2a\u7248\u672c\u5c31\u662f\u4e0d\u4e00\u6837',
  ]));
});

test('findLocalCorpusEvidenceEntries accepts common modal-drop variants for weak slang terms', () => {
  const dictionary = {
    entries: [
      {
        term: '\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f',
        family: 'absolutes',
        meaning: '\u5f3a\u8c03\u60c5\u7eea\u5df2\u65e0\u6cd5\u7ef7\u4f4f',
        evidenceCount: 2,
        evidenceSamples: ['\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f[\u7b11\u54ed]'],
        evidenceSources: [{ source: 'Bilibili local corpus', sample: '\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f[\u7b11\u54ed]' }],
      },
    ],
  };
  const comments = [
    {
      message: '\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a',
      source: 'Bilibili local corpus',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, {
    targetEvidence: 3,
    requireCommentBackedEvidence: true,
  });

  assert.deepEqual(entries.map((entry) => entry.evidenceSamples), [['\u8fd9\u8c01\u7ef7\u5f97\u4f4f\u554a']]);
});

test('findLocalCorpusEvidenceEntries accepts knowledge-substitution variants for weak evasion terms', () => {
  const dictionary = {
    entries: [
      {
        term: '\u4f60\u6ca1\u89c1\u8fc7\u4e0d\u4ee3\u8868\u6ca1\u6709',
        family: 'evasion',
        meaning: '\u7528\u81ea\u5df1\u7684\u7ecf\u9a8c\u53cd\u9a73\u5bf9\u65b9\u7f3a\u5c11\u89c1\u8bc6',
        evidenceCount: 2,
        evidenceSamples: ['\u4f60\u6ca1\u89c1\u8fc7\u4e0d\u4ee3\u8868\u6ca1\u6709'],
        evidenceSources: [{ source: 'Bilibili local corpus', sample: '\u4f60\u6ca1\u89c1\u8fc7\u4e0d\u4ee3\u8868\u6ca1\u6709' }],
      },
    ],
  };
  const comments = [
    {
      message: '\u4f60\u4e0d\u77e5\u9053\u4e0d\u4ee3\u8868\u6ca1\u6709\u3002\u3002\u3002',
      source: 'Bilibili local corpus',
    },
  ];

  const entries = findLocalCorpusEvidenceEntries(dictionary, comments, {
    targetEvidence: 3,
    requireCommentBackedEvidence: true,
  });

  assert.deepEqual(entries.map((entry) => entry.evidenceSamples), [['\u4f60\u4e0d\u77e5\u9053\u4e0d\u4ee3\u8868\u6ca1\u6709\u3002\u3002\u3002']]);
});
