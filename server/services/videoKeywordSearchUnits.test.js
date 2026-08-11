/**
 * Tests for previously-untested pure functions in videoKeywordSearch.js:
 *   - searchNeedlesForRelevance: needle construction + target/query merging
 *   - relevanceScoreForVideo: per-needle length-weighted scoring
 *   - sortVideosByRelevance / filterRelevantVideos: ordering + filtering
 *   - buildVideoContextText / buildTargetVideoObjectEvidenceText: text assembly
 *   - videoContextSources / videoContextSourceUrls: dedup by composite key
 *   - targetTextHitsForDiagnostics: hit counting in training text
 *   - buildCollectionDiagnostics: diagnostics aggregator shape
 *
 * These complement videoKeywordSearch.test.js which covers
 * commentMatchesNeedleSet / filterCommentsByDictionaryNeedles / searchVideoKeywords.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  searchNeedlesForRelevance,
  relevanceScoreForVideo,
  sortVideosByRelevance,
  filterRelevantVideos,
  buildVideoContextText,
  buildTargetVideoObjectEvidenceText,
  videoContextSources,
  videoContextSourceUrls,
  targetTextHitsForDiagnostics,
  buildCollectionDiagnostics,
} from './videoKeywordSearch.js';

describe('searchNeedlesForRelevance', () => {
  test('returns cleaned query needles when no target terms', () => {
    const needles = searchNeedlesForRelevance(['游戏 攻略'], []);
    // '游戏攻略' whole + '游戏' + '攻略' tokens, all length>=2
    assert.ok(needles.includes('游戏'));
    assert.ok(needles.includes('攻略'));
    assert.ok(needles.length >= 2);
  });

  test('all returned needles are length >= 2', () => {
    const needles = searchNeedlesForRelevance(['a b cd ef'], []);
    for (const n of needles) assert.ok(n.length >= 2, `needle too short: ${n}`);
  });

  test('with target terms, target needles appear in the result', () => {
    const needles = searchNeedlesForRelevance(['游戏'], ['辣眼睛']);
    assert.ok(needles.includes('辣眼睛'));
  });

  test('deduplicates needles', () => {
    const needles = searchNeedlesForRelevance(['游戏 游戏', '游戏'], []);
    const set = new Set(needles);
    assert.equal(set.size, needles.length);
  });
});

describe('relevanceScoreForVideo', () => {
  test('returns 0 when video has no searchable text', () => {
    assert.equal(relevanceScoreForVideo({}, ['needle']), 0);
    assert.equal(relevanceScoreForVideo({ title: '' }, ['needle']), 0);
  });

  test('returns 0 when no needles match', () => {
    assert.equal(relevanceScoreForVideo({ title: '完全无关的标题' }, ['辣眼睛']), 0);
  });

  test('accumulates per-needle score (capped at min 1, max 12 per needle by length)', () => {
    // '辣眼睛' length 3 → contributes min(12,max(1,3))=3
    const score = relevanceScoreForVideo({ title: '这个视频辣眼睛' }, ['辣眼睛']);
    assert.equal(score, 3);
  });

  test('a very long needle contributes at most 12', () => {
    const longNeedle = '这是一个非常长的关键词串超过十二个字符长度哦';
    const video = { title: longNeedle };
    const score = relevanceScoreForVideo(video, [longNeedle]);
    assert.equal(score, 12);
  });

  test('sums scores across multiple matching needles', () => {
    // '辣眼睛'(3) + '攻略'(2) = 5
    const score = relevanceScoreForVideo(
      { title: '辣眼睛攻略' },
      ['辣眼睛', '攻略'],
    );
    assert.equal(score, 5);
  });

  test('does not double-count a needle that appears multiple times', () => {
    // '辣眼睛' appears twice but contributes once (3)
    const score = relevanceScoreForVideo({ title: '辣眼睛辣眼睛' }, ['辣眼睛']);
    assert.equal(score, 3);
  });
});

describe('sortVideosByRelevance', () => {
  test('returns videos unchanged when no needles can be built', () => {
    const videos = [{ title: 'a' }, { title: 'b' }];
    assert.deepEqual(sortVideosByRelevance(videos, [], []), videos);
  });

  test('sorts matching videos first by descending score, ties keep original order', () => {
    const videos = [
      { title: '无关' },          // score 0
      { title: '辣眼睛攻略' },    // score 5
      { title: '辣眼睛' },        // score 3
    ];
    const sorted = sortVideosByRelevance(videos, [], ['辣眼睛', '攻略']);
    // highest score first
    assert.equal(sorted[0].title, '辣眼睛攻略');
    assert.equal(sorted[1].title, '辣眼睛');
    assert.equal(sorted[2].title, '无关');
  });

  test('stable: equal-score videos preserve input order', () => {
    const videos = [{ title: '辣眼睛' }, { title: '辣眼睛也在这里' }];
    const sorted = sortVideosByRelevance(videos, [], ['辣眼睛']);
    // both match '辣眼睛' with score 3 → original order preserved
    assert.equal(sorted[0].title, '辣眼睛');
    assert.equal(sorted[1].title, '辣眼睛也在这里');
  });
});

describe('filterRelevantVideos', () => {
  test('returns all videos when no needles can be built', () => {
    const videos = [{ title: 'a' }];
    assert.deepEqual(filterRelevantVideos(videos, [], []), videos);
  });

  test('keeps only videos with at least one matching needle', () => {
    const videos = [
      { title: '辣眼睛视频' },
      { title: '完全无关' },
      { title: '攻略分享' },
    ];
    const out = filterRelevantVideos(videos, [], ['辣眼睛']);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, '辣眼睛视频');
  });
});

describe('buildVideoContextText', () => {
  test('prefixes each unique field with the context label, joined by newlines', () => {
    const text = buildVideoContextText([
      { title: '标题一', desc: '描述一' },
      { title: '标题二', description: '描述二' },
    ]);
    assert.ok(text.includes('Bilibili video context: 标题一'));
    assert.ok(text.includes('Bilibili video context: 描述一'));
    assert.ok(text.includes('Bilibili video context: 标题二'));
    assert.ok(text.includes('Bilibili video context: 描述二'));
  });

  test('collapses whitespace and drops empty fields', () => {
    const text = buildVideoContextText([{ title: '  多   空格  ', desc: '' }]);
    assert.ok(text.includes('Bilibili video context: 多 空格'));
  });

  test('returns empty string for empty input', () => {
    assert.equal(buildVideoContextText([]), '');
  });

  test('deduplicates identical field values', () => {
    const text = buildVideoContextText([
      { title: '同标题', desc: '同标题' },
    ]);
    // '同标题' appears once (deduped across title+desc)
    const occurrences = (text.match(/同标题/g) || []).length;
    assert.equal(occurrences, 1);
  });
});

describe('buildTargetVideoObjectEvidenceText', () => {
  test('returns empty string when no target terms', () => {
    assert.equal(buildTargetVideoObjectEvidenceText([{ title: 'x' }], ['query'], []), '');
  });

  test('returns empty string when no needles can be derived', () => {
    assert.equal(buildTargetVideoObjectEvidenceText([{ title: 'x' }], [], ['辣眼睛']), '');
  });

  test('includes only fields containing a matching needle, with the public-video label', () => {
    const text = buildTargetVideoObjectEvidenceText(
      [{ title: '辣眼睛合集', desc: '无关描述' }],
      [],
      ['辣眼睛'],
    );
    assert.ok(text.includes('Bilibili public video title: 辣眼睛合集'));
    assert.ok(!text.includes('无关描述'));
  });
});

describe('videoContextSources / videoContextSourceUrls', () => {
  test('videoContextSources dedups by bvid+sourceUrl+title composite key', () => {
    const a = { bvid: 'BV1', sourceUrl: 'u1', title: 't1' };
    const dup = { bvid: 'BV1', sourceUrl: 'u1', title: 't1' };
    const b = { bvid: 'BV2', sourceUrl: 'u2', title: 't2' };
    const out = videoContextSources([a, dup], [b]);
    assert.equal(out.length, 2);
  });

  test('videoContextSources filters falsy entries', () => {
    const out = videoContextSources([null, undefined, { bvid: 'BV1' }], []);
    assert.equal(out.length, 1);
  });

  test('videoContextSourceUrls dedups and drops empty urls', () => {
    const out = videoContextSourceUrls(
      [{ sourceUrl: 'https://x' }, { sourceUrl: 'https://x' }, { sourceUrl: '' }, { sourceUrl: 'https://y' }],
      [],
    );
    assert.deepEqual(out, ['https://x', 'https://y']);
  });
});

describe('targetTextHitsForDiagnostics', () => {
  test('returns [] for empty/whitespace training text', () => {
    assert.deepEqual(targetTextHitsForDiagnostics('', ['辣眼睛']), []);
    assert.deepEqual(targetTextHitsForDiagnostics('   ', ['辣眼睛']), []);
  });

  test('counts non-overlapping occurrences of each target term (length>=2)', () => {
    const hits = targetTextHitsForDiagnostics('辣眼睛辣眼睛攻略', ['辣眼睛', '攻略', '短']);
    // '辣眼睛' x2, '攻略' x1, '短' filtered (length 1 < 2)
    const map = Object.fromEntries(hits.map((h) => [h.term, h.count]));
    assert.equal(map['辣眼睛'], 2);
    assert.equal(map['攻略'], 1);
    assert.equal(map['短'], undefined);
  });

  test('omits terms with zero hits', () => {
    const hits = targetTextHitsForDiagnostics('辣眼睛', ['辣眼睛', '不存在']);
    const terms = hits.map((h) => h.term);
    assert.ok(terms.includes('辣眼睛'));
    assert.ok(!terms.includes('不存在'));
  });
});

describe('buildCollectionDiagnostics', () => {
  test('returns the expected diagnostic shape with counts', () => {
    const diag = buildCollectionDiagnostics({
      discoveredVideos: [{ bvid: 'BV1' }],
      discoveryContextVideos: [{ bvid: 'BV2' }],
      videos: [{ bvid: 'BV3', title: 't3' }],
      comments: [{ message: 'a' }, { message: 'b' }],
      trainingText: '辣眼睛',
      targetExistingTerms: ['辣眼睛'],
      keywordTraining: { entries: [{ term: '辣眼睛' }], evidenceRejected: 2 },
    });
    assert.equal(diag.discoveredVideos, 1);
    assert.equal(diag.discoveryContextVideos, 1);
    assert.equal(diag.scannedVideos, 1);
    assert.equal(diag.commentsCollected, 2);
    assert.equal(diag.trainingTextChars, 3);
    assert.deepEqual(diag.targetExistingTerms, ['辣眼睛']);
    assert.ok(diag.targetTextHits.length >= 1);
    assert.ok(diag.acceptedTerms.includes('辣眼睛'));
    assert.equal(diag.evidenceRejected, 2);
    assert.ok(Array.isArray(diag.sampleVideos));
  });

  test('falls back through videos → discoveryContextVideos → discoveredVideos for sampleVideos', () => {
    const d1 = buildCollectionDiagnostics({ discoveredVideos: [{ bvid: 'BV1' }] });
    assert.equal(d1.sampleVideos[0].bvid, 'BV1');
    const d2 = buildCollectionDiagnostics({ discoveryContextVideos: [{ bvid: 'BV2' }] });
    assert.equal(d2.sampleVideos[0].bvid, 'BV2');
  });

  test('sampleVideos is capped at 5', () => {
    const videos = Array.from({ length: 10 }, (_, i) => ({ bvid: `BV${i}` }));
    const diag = buildCollectionDiagnostics({ videos });
    assert.ok(diag.sampleVideos.length <= 5);
  });
});
