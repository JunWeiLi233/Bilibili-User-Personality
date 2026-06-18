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
    { term: '阴阳', family: 'attack', meaning: '阴阳怪气地讽刺、含沙射影' },
    { term: '笑哭', family: 'cooperation', meaning: '笑哭表情，用于表示哭笑不得、调侃或自嘲，缓和语气' },
    { term: '没有', family: 'absolutes', meaning: '全称否定，强调不存在某种情况' },
    { term: '不是', family: 'attack', meaning: '直接否定或反驳对方观点，表示不赞同' },
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

test('detectEmoteSemanticHits treats ASCII emoticons as tone markers', () => {
  const hits = detectEmoteSemanticHits('可爱^_^ 1');

  assert.deepEqual(hits.map((hit) => hit.term), ['ASCII emoticon tone marker']);
  assert.equal(hits[0].family, 'cooperation');
});

test('classifyCommentCoverage keeps doge satire when a generic lexical term also matches', () => {
  const result = classifyCommentCoverage(dictionary, '\u4e0d\u52aa\u529b\u53ef\u80fd\u4f1a\u88ab\u8d25\u5149\u5bb6\u4e1a[doge]');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['可能', 'doge/反讽表情']);
  assert.match(result.reason, /emoji\/emote/i);
});

test('classifyCommentCoverage keeps Tieba ASCII emoticon tone cues', () => {
  const result = classifyCommentCoverage(dictionary, '可爱^_^ 1');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['ASCII emoticon tone marker']);
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

test('classifyCommentCoverage captures strong negative affect as semantic coverage', () => {
  const result = classifyCommentCoverage(dictionary, '\u597d\u6076\u5fc3');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['恶心']);
});

test('classifyCommentCoverage captures standalone pei dismissal', () => {
  const result = classifyCommentCoverage(dictionary, '\u5478');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u5478']);
});

test('classifyCommentCoverage captures targeted stupid insults without matching benign cute phrasing', () => {
  const insult = classifyCommentCoverage(dictionary, '\u5370\u5ea6\u4eba\u8822\u662f\u8822\uff0c\u57fa\u672c\u793c\u4eea\u90fd\u6ca1\u6709');
  const benign = classifyCommentCoverage(dictionary, '\u8fd9\u53ea\u732b\u6709\u70b9\u8822\u840c');

  assert.equal(insult.covered, true);
  assert.equal(insult.mode, 'keyword');
  assert.ok(insult.hits.some((hit) => hit.term === '\u8822'));
  assert.equal(benign.covered, true);
  assert.equal(benign.mode, 'neutral');
  assert.equal(benign.hits.length, 0);
});

test('classifyCommentCoverage captures whitewashing accusations without matching literal washing', () => {
  const accusation = classifyCommentCoverage(dictionary, '\u4e5f\u591f\u522b\u6d17\u4e86');
  const literal = classifyCommentCoverage(dictionary, '\u522b\u6d17\u8863\u670d\u4e86\uff0c\u660e\u5929\u4e0b\u96e8');

  assert.equal(accusation.covered, true);
  assert.equal(accusation.mode, 'keyword');
  assert.deepEqual(accusation.hits.map((hit) => hit.term), ['\u522b\u6d17\u4e86']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage captures audience-taste sarcasm', () => {
  const result = classifyCommentCoverage(dictionary, '\u5982\u679c\u4e2d\u56fd\u5927\u4f17\u771f\u7684\u6709\u54c1\u5473\u4f1a\u6709\u7968\u51a0\u6ee1\u6c5f\u7ea2\uff1f');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u6709\u54c1\u5473...\u6ee1\u6c5f\u7ea2']);
});

test('classifyCommentCoverage captures homophone insults even when absolutes also match', () => {
  const result = classifyCommentCoverage(dictionary, '\u521a\u8fdb\u9662\uff0c\u73af\u5883\u5f88\u5dee\uff0c\u5168\u90fd\u662f\u6c99\u58c1');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['沙壁/傻逼']);
});

test('classifyCommentCoverage captures ancestor-address passive aggression', () => {
  const result = classifyCommentCoverage(dictionary, '\u4f60\u7956\u5b97\u5230\u6b64\u4e00\u6e38 1');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['你祖宗']);
});

test('classifyCommentCoverage captures animalized female-group insults', () => {
  const result = classifyCommentCoverage(dictionary, '\u73a9\u5b59\u5427\u7684\u5973\u751f\u90fd\u957f\u4ec0\u4e48\u6837\uff1f \u60f3\u770b\u4e00\u4e0b\u5427\u5185\u5973\u9f20\u4eec\u7684\u989c\u503c');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['女鼠/母狗/母猪']);
});

test('classifyCommentCoverage captures mild profanity as strong tone', () => {
  const result = classifyCommentCoverage(dictionary, '我草我大学就是在威海上的');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['我草/卧槽']);
});

test('classifyCommentCoverage captures targeted dog insults without matching literal dogs', () => {
  const insult = classifyCommentCoverage(dictionary, '谁再买我笑他是狗');
  const literal = classifyCommentCoverage(dictionary, '我家的狗今天很乖');

  assert.equal(insult.covered, true);
  assert.equal(insult.mode, 'keyword');
  assert.deepEqual(insult.hits.map((hit) => hit.term), ['是狗']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage captures knife-threat memes without matching literal knives', () => {
  const threat = classifyCommentCoverage(dictionary, '\u6211\u5200\u5462\uff1f\uff01');
  const literal = classifyCommentCoverage(dictionary, '\u6211\u7684\u5200\u5462\uff0c\u505a\u996d\u8981\u7528');

  assert.equal(threat.covered, true);
  assert.equal(threat.mode, 'keyword');
  assert.deepEqual(threat.hits.map((hit) => hit.term), ['\u6211\u5200\u5462']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage captures sampled derogatory nickname compounds', () => {
  const result = classifyCommentCoverage(dictionary, '\u6218\u795e\u72d7\u548c\u98de\u821e\u8d3c');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u6218\u795e\u72d7/\u98de\u821e\u8d3c']);
});

test('classifyCommentCoverage captures standalone get-lost insults without matching rolling words', () => {
  const insult = classifyCommentCoverage(dictionary, '\u201c\u6eda\u201d');
  const literal = classifyCommentCoverage(dictionary, '\u5c4f\u5e55\u6eda\u52a8\u4e00\u4e0b');

  assert.equal(insult.covered, true);
  assert.equal(insult.mode, 'keyword');
  assert.deepEqual(insult.hits.map((hit) => hit.term), ['\u6eda']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage captures sexualized driving slang without matching literal driving', () => {
  const slang = classifyCommentCoverage(dictionary, '眼神开车开始了');
  const literal = classifyCommentCoverage(dictionary, '今天下雨开车慢一点');

  assert.equal(slang.covered, true);
  assert.equal(slang.mode, 'keyword');
  assert.deepEqual(slang.hits.map((hit) => hit.term), ['开车/眼神开车']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage captures targeted bi profanity without matching neutral syllables', () => {
  const insult = classifyCommentCoverage(dictionary, '上单:这个逼中单死了两次了');
  const neutral = classifyCommentCoverage(dictionary, '逼近终点的时候不要急');

  assert.equal(insult.covered, true);
  assert.equal(insult.mode, 'keyword');
  assert.deepEqual(insult.hits.map((hit) => hit.term), ['这个逼']);
  assert.equal(neutral.covered, true);
  assert.equal(neutral.mode, 'neutral');
  assert.equal(neutral.hits.length, 0);
});

test('classifyCommentCoverage captures Bilibili emotional death memes', () => {
  const result = classifyCommentCoverage(dictionary, '啊啊啊啊啊我反复去世！！！太好看了');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['反复去世']);
});

test('classifyCommentCoverage captures freeloading slang without matching unrelated color text', () => {
  const slang = classifyCommentCoverage(dictionary, '至从出了王棋后已经纯白嫖了，月卡都不愿给了');
  const literal = classifyCommentCoverage(dictionary, '白色的嫖字写错了');

  assert.equal(slang.covered, true);
  assert.equal(slang.mode, 'keyword');
  assert.deepEqual(slang.hits.map((hit) => hit.term), ['白嫖']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage suppresses factual no-have statements', () => {
  const result = classifyCommentCoverage(dictionary, '\u5e7f\u7535\u6ca1\u6709CCTV16\u9891\u9053\uff0c\u5176\u4ed6\u4e09\u5927\u8fd0\u8425\u5546iptv\u6709CCTV16\u9891\u9053');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage suppresses logical not-is disagreement', () => {
  const result = classifyCommentCoverage(dictionary, '\u4eba\u5bb6\u662f\u8981\u505a\u5c71\u6cbb\uff0c\u4e0d\u662f\u505a\u53a8\u5e08\uff0c\u6446\u644a\u8ddf\u4f60\u7a7f\u5565\u8863\u670d\u4e00\u70b9\u5173\u7cfb\u6ca1\u6709');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage treats dog emoji as a Chinese platform tone marker', () => {
  const result = classifyCommentCoverage(dictionary, '\u60a8\u7684\u5e16\u5b50\u91cc\u9762\u6709\u6761\u76ee\ud83d\udc36\uff0c\u8d76\u7d27\u7f6e\u9876\u7f9e\u8fb1');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['狗头/狗称呼表情']);
});

test('classifyCommentCoverage does not turn laugh-cry self-mockery into attack by itself', () => {
  const result = classifyCommentCoverage(dictionary, '[\u7b11\u54ed] \u96be\u5d29[\u7b11\u54ed]');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['笑哭']);
});

test('classifyCommentCoverage suppresses literal classical yin-yang contexts', () => {
  const result = classifyCommentCoverage(dictionary, '\u5929\u9053\u65e0\u80fd\uff0c\u9634\u9633\u9006\u4e71\uff0c\u9b51\u9b45\u9b4d\u9b49\u6d82\u70ad\u751f\u7075\u3002\u91d1\u5149\u795e\u5492 \u5929\u5730\u7384\u5b97');

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
