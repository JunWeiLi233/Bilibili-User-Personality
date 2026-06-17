import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCommentCoverage, detectEmoteSemanticHits, sampleCommentCoverage } from './commentCoverage.js';

const dictionary = {
  entries: [
    { term: '懂的都懂', family: 'evasion', meaning: '暗示式回避说明', aliases: ['dddd'] },
    { term: '查查资料', family: 'evidence', meaning: '要求对方自行查证' },
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
