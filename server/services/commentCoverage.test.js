import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCommentCoverage, detectEmoteSemanticHits, sampleCommentCoverage } from './commentCoverage.js';

const dictionary = {
  entries: [
    { term: '懂的都懂', family: 'evasion', meaning: '暗示式回避说明', aliases: ['dddd'] },
    { term: '查查资料', family: 'evidence', meaning: '要求对方自行查证' },
    { term: '可能', family: 'cooperation', meaning: '缓和语气的可能性标记' },
    { term: '小白', family: 'attack', meaning: '贬低对方不懂的新手标签' },
    { term: '手残', family: 'attack', meaning: '贬低操作能力差' },
  ],
};

test('classifyCommentCoverage reports keyword coverage when a dictionary term appears', () => {
  const result = classifyCommentCoverage(dictionary, '这事懂的都懂，不展开了');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['懂的都懂']);
});

test('detectEmoteSemanticHits treats Bilibili emotes as satire and tone markers', () => {
  const hits = detectEmoteSemanticHits('皇马：我谢谢你啊[doge]');

  assert.deepEqual(hits.map((hit) => hit.term), ['doge/反讽表情']);
  assert.match(hits[0].meaning, /反讽/);
});

test('classifyCommentCoverage covers pure emoji and emote comments semantically', () => {
  const result = classifyCommentCoverage(dictionary, '[藏狐][藏狐]');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.equal(result.reason, 'emoji/emote semantic marker matched');
  assert.equal(result.hits[0].term, '嘲讽/看戏表情');
});

test('classifyCommentCoverage keeps doge satire when a generic lexical term also matches', () => {
  const result = classifyCommentCoverage(dictionary, '\u4e0d\u52aa\u529b\u53ef\u80fd\u4f1a\u88ab\u8d25\u5149\u5bb6\u4e1a[doge]');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['可能', 'doge/反讽表情']);
  assert.match(result.reason, /emoji\/emote/i);
});

test('classifyCommentCoverage suppresses self-referential novice attack hits', () => {
  const result = classifyCommentCoverage(dictionary, '\u6211\u4e5f\u662f\u5c0f\u767d\uff0c\u4f60\u7ed9\u54b1\u4eec\u5efa\u4e2a\u7fa4\u5427');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage does not attribute keyword hits inside reply usernames', () => {
  const result = classifyCommentCoverage(dictionary, '\u56de\u590d @\u624b\u6b8b\u4e2d\u7684\u624b\u6b8b\u73a9\u5bb6 :\u5df2\u7ecf\u662f\u65e9\u5e74\u4e86');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage treats ordinary supportive speech as neutral analyzable coverage', () => {
  const result = classifyCommentCoverage(dictionary, '一路带来无数欢声笑语，累了就安心入睡吧，好好休息。');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
  assert.match(result.reason, /no dictionary risk term/i);
});

test('sampleCommentCoverage summarizes full coverage over keyword and neutral samples', () => {
  const result = sampleCommentCoverage(dictionary, [
    '这事懂的都懂，不展开了',
    '一路带来无数欢声笑语，累了就安心入睡吧。',
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.covered, 2);
  assert.equal(result.coverageRatio, 1);
  assert.deepEqual(result.byMode, { keyword: 1, neutral: 1, uncovered: 0 });
});
