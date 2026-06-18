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
  assert.ok(result.hits.some((hit) => hit.term === '懂的都懂'));
});

test('classifyCommentCoverage captures round 38 random audit misses', () => {
  const cases = [
    [
      '\u62c9\u8349\u4e1b\u91cc\u6211\u90fd\u4e0d\u8bf4\u4ec0\u4e48\u4e86\uff0c\u4eba\u5bb6\u77e5\u9053\u9760\u8fb9\uff0c\u6211\u4eec\u8fd9\u6709\u4e00\u6bb5\u8def\u7684\u4eba\u884c\u9053\u4e0a\u5168\u662f\uff0c\u8d70\u54ea\u6761\u8def\u5c31\u8ddf\u8fdb\u96f7\u533a\u4f3c\u7684',
      ['\u8ddf\u8fdb\u96f7\u533a\u4f3c\u7684'],
    ],
    ['\u4f60\u4e0d\u8ba4\u53ef\u90a3\u5c31\u522b\u505a\u4eba\u4e86', ['\u522b\u505a\u4eba\u4e86']],
    ['\u4f60\u591a\u6b7b\u51e0\u6b21\uff0c\u4f18\u52bf\u5c31\u56de\u6765\u4e86', ['\u591a\u6b7b\u51e0\u6b21']],
    ['\u597dtn\u7684\u98a0', ['tn\u7684\u98a0']],
  ];

  for (const [comment, expectedTerms] of cases) {
    const result = classifyCommentCoverage(dictionary, comment);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
  }
});

test('classifyCommentCoverage suppresses round 38 random audit false positives', () => {
  const neutralCases = [
    '\u5b83\u4eec\u7528\u4e86\u4e0a\u5343\u5e74\u6253\u9020\u51fa\u4e00\u4e2a\u6838\u52a8\u529b\u9a74\u751f\u6001\u7cfb\u7edf\uff0c\u4e0d\u53ef\u80fd\u56e0\u6b64\u65f6\u4ee3\u800c\u5d29\u574f',
    '\u65e2\u89c6\u611f\u53d1\u529b\u4e86',
    '\u519b\u54c1\u662f\u4ec0\u4e48\u6982\u5ff5\u5462\uff0c\u5c31\u662f\u6280\u672f\u4e0d\u4e00\u5b9a\u9ad8\uff0c\u4f46\u53ef\u9760\u6027\u7edd\u5bf9\u6700\u9ad8\uff0c\u5c5e\u4e8e\u90a3\u79cd\u4e00\u5957\u9ad8\u5f3a\u5ea6\u6d4b\u8bd5\u4e0b\u6765\uff0c\u8fde\u6f06\u90fd\u4e0d\u6389\u7684\u90a3\u79cd(',
  ];

  for (const comment of neutralCases) {
    const result = classifyCommentCoverage(dictionary, comment);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }
});

test('classifyCommentCoverage captures round 39 random audit misses', () => {
  const cases = [
    ['\u6839\u672c\u65e0\u6cd5\u6cbb\u6108', ['\u6839\u672c']],
    ['\u5531\u620f\u7684\u8154', ['\u5531\u620f\u7684\u8154']],
  ];

  for (const [comment, expectedTerms] of cases) {
    const result = classifyCommentCoverage(dictionary, comment);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
  }
});

test('classifyCommentCoverage suppresses round 39 random audit overlap artifacts', () => {
  const overlapDictionary = {
    entries: [
      { term: '\u6709\u4e00\u8bf4\u4e00', family: 'cooperation', meaning: '\u5ba2\u89c2\u8868\u8fbe', aliases: ['\u4e0d\u9ed1\u4e0d\u5439'] },
      { term: '\u5f00\u73a9\u7b11', family: 'attack', meaning: '\u8bbd\u523a\u6216\u8d28\u7591' },
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: '\u5168\u79f0\u5426\u5b9a' },
      { term: '\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3', family: 'attack', meaning: '\u7f3a\u4e4f\u97f3\u4e50\u7406\u89e3\u80fd\u529b' },
      { term: '\u6beb\u65e0\u97f3\u4e50\u7406\u89e3', family: 'attack', meaning: '\u7f3a\u4e4f\u97f3\u4e50\u7406\u89e3\u80fd\u529b' },
      { term: '\u8d85\u7edd\u65e0\u8bed', family: 'attack', meaning: '\u6781\u5ea6\u65e0\u8bed\u548c\u5410\u69fd' },
      { term: '\u65e0\u8bed', family: 'cooperation', meaning: '\u8f7b\u677e\u4e92\u52a8' },
    ],
  };
  const cases = [
    ['\u6709\u4e00\u8bf4\u4e00\uff0c\u8fd9\u4e2a\u8d28\u91cf\uff0c\u4e0d\u5f00\u73a9\u7b11\u771f\u5f97\u6362\u4e00\u6279\u3002', ['\u6709\u4e00\u8bf4\u4e00']],
    ['\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3', ['\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3']],
    ['\u8d85\u7edd\u65e0\u8bed', ['\u8d85\u7edd\u65e0\u8bed']],
  ];

  for (const [comment, expectedTerms] of cases) {
    const result = classifyCommentCoverage(overlapDictionary, comment);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
  }
});

test('classifyCommentCoverage captures round 40 random audit misses', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u90a3\u6211\u73a9\u96c6\u8d38\u554a');

  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u73a9\u96c6\u8d38']);
  assert.equal(result.hits[0].family, 'attack');
});

test('classifyCommentCoverage suppresses round 40 random audit false positives', () => {
  const round40Dictionary = {
    entries: [
      { term: '\u7edd\u5bf9', family: 'absolutes', meaning: '\u5f3a\u65ad\u8a00', aliases: ['\u7edd'] },
      { term: '\u4e0d\u662f', family: 'attack', meaning: '\u76f4\u63a5\u5426\u5b9a' },
      { term: '\u786e\u5b9e', family: 'cooperation', meaning: '\u8ba4\u540c\u6216\u627f\u8ba4' },
      { term: '\u54c8\u54c8\u54c8', family: 'attack', meaning: '\u5632\u7b11' },
      { term: '\u54c8\u54c8', family: 'cooperation', meaning: '\u7b11\u58f0' },
      { term: '\u5c0f\u4e11', family: 'attack', meaning: '\u8d2c\u635f\u7f51\u7edc\u79f0\u547c' },
      { term: 'nt', family: 'attack', meaning: '\u8111\u762b\u7f29\u5199' },
      { term: '\u81ea\u5f8b', family: 'cooperation', meaning: '\u652f\u6301\u6027\u8868\u8fbe' },
    ],
  };
  const cases = [
    [
      '\u4ed6\u786e\u5b9e\u4e0d\u662f\u5efa\u6a21\u8138\uff0c\u4f46\u957f\u5f97\u7709\u76ee\u542b\u60c5\uff0c\u771f\u7684\u597d\u6b32\u597d\u7edd!',
      ['\u786e\u5b9e'],
    ],
    ['\u54c8\u54c8\u54c8\u70eb\u5589\u5499', ['\u54c8\u54c8']],
    ['52\u5f20\u7b97\u7684\u8bdd\u5c0f\u4e11\u67092\u53ea\u54c7', []],
    ['\u6070\u597d\u662f\u7b2c140\u54e5\uff0c\u6211\u6536\u85cfin the good music\u6536\u85cf\u5939\u7684\u89c6\u9891', []],
    ['\u5728\u5047\u671f\u5982\u4f55\u81ea\u5f8b\uff1f\u53ca\u65f6\u5c3d\u65e9\u5eb7\u590d\u51fa\u9662\u3002', []],
  ];

  for (const [comment, expectedTerms] of cases) {
    const result = classifyCommentCoverage(round40Dictionary, comment);
    assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
    assert.equal(result.mode, expectedTerms.length ? 'keyword' : 'neutral');
  }
});

test('classifyCommentCoverage captures round 41 random audit misses', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u80fd\u6293\u5230\u6700\u597d\u628a\u4ed6\u817f\u6253\u6298\uff01');

  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u6253\u65ad\u817f/\u817f\u6253\u6298']);
  assert.equal(result.hits[0].family, 'attack');
});

test('classifyCommentCoverage suppresses round 41 random audit false positives', () => {
  const round41Dictionary = {
    entries: [
      { term: '\u5bb6\u4eba', family: 'cooperation', meaning: '\u7c89\u4e1d\u4eb2\u8fd1\u79f0\u547c' },
      { term: '\u7edd\u6740', family: 'attack', meaning: '\u7ec8\u7ed3\u8ba8\u8bba\u7684\u72e0\u8bdd' },
      { term: '\u5c31\u662f', family: 'cooperation', meaning: '\u8d5e\u540c\u9644\u548c' },
      { term: '\u70b9\u8d5e', family: 'cooperation', meaning: '\u652f\u6301\u8ba4\u540c' },
    ],
  };
  const cases = [
    ['\u517b\u4e45\u4e86\u6210\u5bb6\u4eba\u4e86', []],
    ['\u770b\u5230\u6b27\u6587\u7bee\u4e0b\u8865\u7bee\u7edd\u6740\uff0c\u610f\u56fe\u5c31\u662f\u8fd9\u4e48\u660e\u663e', []],
    ['\u70b9\u8d5e\u4e5f\u53d8\u7eff\u4e86\u5509', []],
  ];

  for (const [comment, expectedTerms] of cases) {
    const result = classifyCommentCoverage(round41Dictionary, comment);
    assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
    assert.equal(result.mode, expectedTerms.length ? 'keyword' : 'neutral');
  }

  const emote = classifyCommentCoverage({ entries: [] }, '\u53c8\u8ba9\u6211\u60f3\u8d77\u90a3\u4e2a\u89c6\u9891\u4e86[\u559c\u6781\u800c\u6ce3]');
  assert.equal(emote.mode, 'keyword');
  assert.deepEqual(emote.hits.map((hit) => [hit.term, hit.family]), [['\u559c\u6781\u800c\u6ce3\u8868\u60c5', 'cooperation']]);
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
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [
    ['\u5efa\u4e2a\u7fa4\u5427', 'cooperation'],
  ]);
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

test('classifyCommentCoverage captures salted-fish satire without matching literal food', () => {
  const satire = classifyCommentCoverage(dictionary, '\u5728\u4f60\u9762\u524d\u7684\u662f\u4e00\u4f4d\u771f\u6b63\u7684\u82f1\u96c4\uff08\u54b8\u9c7c\uff09');
  const literal = classifyCommentCoverage(dictionary, '\u665a\u4e0a\u5403\u54b8\u9c7c\u8304\u5b50\u7172');

  assert.equal(satire.covered, true);
  assert.equal(satire.mode, 'keyword');
  assert.deepEqual(satire.hits.map((hit) => hit.term), ['\u54b8\u9c7c']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage suppresses neutral traffic and speculative broadener hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'absolute generalization' },
      { term: '\u6d41\u91cf', family: 'attack', meaning: 'traffic-star derogation when aimed at a creator' },
      { term: '\u5e94\u8be5', family: 'cooperation', meaning: 'soft speculative modal' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u56fd\u5185\u53bb\u7684\u5e94\u8be5\u90fd\u662f\u60f3\u505a\u81ea\u5a92\u4f53\u7684\u5427\u2026\u5370\u5ea6\u6d41\u91cf\u5f88\u5927\u7684');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage captures sampled adaptation and noise complaints', () => {
  const adaptation = classifyCommentCoverage(dictionary, '\u6263\u673a\u793e\u6bc1\u539f\u4f5c\u7684\u6982\u7387\u4e0d\u4e9a\u4e8e\u7269\u7406\u7a81\u7834\u91cf\u5b50\u9886\u57df');
  const noise = classifyCommentCoverage(dictionary, '\u8fd9\u7fa4\u6401\u8fd9\u8bf4\u4ec0\u4e48\u5462 \u8042\u7684\u8111\u4ec1\u75bc');

  assert.equal(adaptation.covered, true);
  assert.equal(adaptation.mode, 'keyword');
  assert.ok(adaptation.hits.some((hit) => hit.term === '\u6bc1\u539f\u4f5c'));
  assert.equal(noise.covered, true);
  assert.equal(noise.mode, 'keyword');
  assert.ok(noise.hits.some((hit) => hit.term === '\u8111\u4ec1\u75bc'));
});

test('classifyCommentCoverage captures sampled numeric and kinship sarcasm attacks', () => {
  const cognition = classifyCommentCoverage(dictionary, '\u4f60\u7684\u8ba4\u77e5\u5c31200\uff0c\u522b\u4eba\u5462');
  const kinship = classifyCommentCoverage(dictionary, '\u632a\u5a01\u9996\u5bcc\u548c\u4f60\u662f\u670b\u53cb\uff0c\u9a6c\u4e91\u8fd8\u662f\u6211\u4eec\u7684\u7238\u7238\u5462');

  assert.equal(cognition.covered, true);
  assert.equal(cognition.mode, 'keyword');
  assert.ok(cognition.hits.some((hit) => hit.term === '200'));
  assert.equal(kinship.covered, true);
  assert.equal(kinship.mode, 'keyword');
  assert.ok(kinship.hits.some((hit) => hit.term === '\u7238\u7238\u5462'));
});

test('classifyCommentCoverage suppresses sampled rhetorical feeling and outcome narration hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u4e3a\u4ec0\u4e48', family: 'evidence', meaning: 'asks for reason or source' },
      { term: '\u53ef\u80fd', family: 'cooperation', meaning: 'soft speculative modal' },
      { term: '\u4e0a\u5cb8', family: 'cooperation', meaning: 'successful landing or transition' },
    ],
  };
  const feeling = classifyCommentCoverage(sampledDictionary, '\u660e\u660e\u662f\u5411\u9633\u751f\u957f\u7684\u5411\u65e5\u8475\uff0c\u4e3a\u4ec0\u4e48\u6709\u79cd\u4f4e\u7740\u5934\u4fef\u89c6\u6211\u7684\u611f\u89c9');
  const outcome = classifyCommentCoverage(sampledDictionary, '\u662f\u7684\uff0cJade\u4e5f\u4f20\u7edf\u5bb3\u60e8\u4e86\uff0c\u5982\u679c\u5979\u5f53\u521d\u6293\u4f4f\u7684\u662f\u6cf0\u52d2\u5979\u771f\u7684\u6709\u53ef\u80fd\u4e0a\u5cb8\u4e86');

  assert.equal(feeling.covered, true);
  assert.equal(feeling.mode, 'neutral');
  assert.equal(feeling.hits.length, 0);
  assert.equal(outcome.covered, true);
  assert.equal(outcome.mode, 'neutral');
  assert.equal(outcome.hits.length, 0);
});

test('classifyCommentCoverage suppresses playful standalone laughter hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u54c8\u54c8\u54c8', family: 'attack', meaning: 'sarcastic laughter' },
      { term: '\u54c8\u54c8', family: 'cooperation', meaning: 'ordinary laughter' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u70b8\u4e86\u72d7\u7a9d\u4e86\u54c8\u54c8\u54c8\u54ce');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
});

test('classifyCommentCoverage captures sampled dianpo insult', () => {
  const result = classifyCommentCoverage(dictionary, '\u98a0\u5a46');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.ok(result.hits.some((hit) => hit.term === '\u98a0\u5a46'));
});

test('classifyCommentCoverage suppresses passive criticism report hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u88ab\u9a82', family: 'attack', meaning: 'being cursed or criticized' },
      { term: '\u786e\u5b9e', family: 'cooperation', meaning: 'agreement marker' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u7279\u65af\u62c9\u867d\u7136\u5929\u5929\u88ab\u9a82\uff0c\u4f46\u9500\u91cf\u786e\u5b9e\u8fd8\u53ef\u4ee5');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u786e\u5b9e']);
});

test('classifyCommentCoverage suppresses positive nickname hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u5c11\u7fbd', family: 'attack', meaning: 'ambiguous attack phrase' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u5c11\u7fbd\u8d85\u725b\u6bd4\uff08\u751f\u7269\uff09');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.equal(result.hits.length, 0);
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

test('classifyCommentCoverage captures contextual sarcastic praise without matching plain praise', () => {
  const sarcasm = classifyCommentCoverage(dictionary, '\u4e0d\u810f\uff0c\u4f60\u7684\u8bdd\u662f\u5929\u7c41');
  const praise = classifyCommentCoverage(dictionary, '\u5979\u7684\u58f0\u97f3\u771f\u7684\u662f\u5929\u7c41');

  assert.equal(sarcasm.covered, true);
  assert.equal(sarcasm.mode, 'keyword');
  assert.deepEqual(sarcasm.hits.map((hit) => hit.term), ['\u4f60\u7684\u8bdd\u662f\u5929\u7c41']);
  assert.equal(praise.covered, true);
  assert.equal(praise.mode, 'neutral');
  assert.equal(praise.hits.length, 0);
});

test('classifyCommentCoverage suppresses nb slang inside longer Latin acronyms', () => {
  const sampledDictionary = {
    entries: [
      { term: 'nb', family: 'absolutes', meaning: '\u725b\u903c\u7684\u7f29\u5199' },
    ],
  };
  const acronym = classifyCommentCoverage(sampledDictionary, 'NBA\u672c\u6765\u5f88\u62c9\uff0c\u7ed3\u679c\u8ddf\u4e52\u4e53\u7403\u5bf9\u6bd4\u53ef\u592a\u6e05\u4e86');
  const slang = classifyCommentCoverage(sampledDictionary, '\u4f60\u662f\u771f\u7684nb');

  assert.equal(acronym.covered, true);
  assert.equal(acronym.mode, 'neutral');
  assert.equal(acronym.hits.length, 0);
  assert.equal(slang.covered, true);
  assert.equal(slang.mode, 'keyword');
  assert.deepEqual(slang.hits.map((hit) => hit.term), ['nb']);
});

test('classifyCommentCoverage treats quoted broadener sarcasm as evasion instead of speaker absolute', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'absolute broadener' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u8fd9\u53e5\u201c\u90fd\u662f\u56fd\u5916\u5f15\u8fdb\u7684\u201d\u6709\u70b9\u641e\u7b11');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u5f15\u8bed\u91cc\u7684\u90fd\u662f']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['evasion']);
});

test('classifyCommentCoverage treats nanbeng title comments as sarcasm, not cooperation', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u96be\u868c', family: 'cooperation', meaning: 'light interaction' },
    ],
  };
  const result = classifyCommentCoverage(sampledDictionary, '\u96be\u868c\u6807\u9898');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u96be\u868c/\u96be\u7ef7']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures urgent-danmaku sarcasm as attack', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u5f39\u5e55\u597d\u6025\u554a\uff0c\u751f\u6d3b\u81ea\u5df1\u6ca1\u670b\u53cb\u8fd8\u89c1\u4e0d\u5230\u522b\u4eba\u73a9\u7b11\u5417');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u5f39\u5e55\u597d\u6025\u554a']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures gezhe rhetorical short-drama accusation', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u6401\u7740\u770b\u77ed\u5267\u5462\uff1f\uff1f');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u6401\u7740\u770b\u77ed\u5267\u5462']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures zombie-dog dehumanizing insults', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u50f5\u5c38\u4e00\u6837\u7684\u72d7');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u50f5\u5c38\u4e00\u6837\u7684\u72d7']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures family-level hooligan insults', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u7eaf\u4e00\u5bb6\u5b50\u81ed\u6d41\u6c13');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u4e00\u5bb6\u5b50\u81ed\u6d41\u6c13']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures hostile plot-writing rants', () => {
  const comment = '\u4e71\u5199\u662f\u8fd9\u6837\u7684\uff0c\u5199\u4e0d\u4e0b\u53bb\u5c31\u5f00\u59cb\u4e71\u5199\u4e86\uff0c\u8ddf\u7279\u4e48\u868a\u5b50\u6709\u4e0d\u5438\u4eba\u7684\u597d\u868a\u4f3c\u7684\u795e\u7ecf\u5267\u672c';
  const result = classifyCommentCoverage({ entries: [] }, comment);

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u4e71\u5199/\u795e\u7ecf\u5267\u672c']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures sampled Latin profanity', () => {
  const tmd = classifyCommentCoverage({ entries: [] }, 'tmd\u6211\u5f00\u7a7a\u8c03\uff0c\u60f3\u4ec0\u4e48\u65f6\u5019\u5f00\u5c31\u4ec0\u4e48\u65f6\u5019\u5f00');
  const tm = classifyCommentCoverage({ entries: [] }, '2024\u5e74\u4e86\uff0c\u8fd8tm\u6ca1\u6539');

  assert.equal(tmd.covered, true);
  assert.equal(tmd.mode, 'keyword');
  assert.deepEqual(tmd.hits.map((hit) => hit.term), ['tm/tmd']);
  assert.deepEqual(tmd.hits.map((hit) => hit.family), ['attack']);
  assert.deepEqual(tm.hits.map((hit) => hit.term), ['tm/tmd']);
  assert.deepEqual(tm.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures hostile jail-wish sarcasm', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u966a\u4e0d\u4e86\u5750\u7262\uff0c\u5750\u51e0\u5e74\u7262\u518d\u8bf4\u5427\u3002');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u5750\u7262']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures sampled sarcasm and negative accusation misses', () => {
  const bossy = classifyCommentCoverage({ entries: [] }, '\u8bf4\u662f\u867d\u7136\u8282\u76ee\u53ea\u6709\u77ed\u77ed\u51e0\u5341\u5206\u949f\uff0c\u4f46\u662f\u9ea6\u718f\u9e21\u73b0\u573a\u6298\u817e\u4e86\u56db\u4e2a\u591a\u5c0f\u65f6\uff0c\u5927\u5bb6\u5168\u90fd\u51cc\u6668\u4e09\u70b9\u591a\u624d\u7761[\u7b11\u54ed][\u7b11\u54ed][\u7b11\u54ed]\u611f\u89c9\u6768\u5b50\u8fd9\u4e2a\u5927\u7239\u90fd\u7ed9\u6298\u817e\u7d2f\u4e86\uff0c\u6f14\u4e0d\u4e0b\u53bb\u4e86[\u7b11\u54ed]');
  const cleanStream = classifyCommentCoverage({ entries: [] }, '\u8bf4\u4e2a\u7b11\u8bdd\uff1b\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8 \uff01NBA\uff0c\u6e05\u6d41\u5927\u5927\u6ef4\uff01');
  const hate = classifyCommentCoverage({ entries: [] }, '\u6211\u6068\u90a3\u4e9b\u5bfc\u81f4\u4f60\u505c\u4e0b\u7684\u4eba\uff0c\u597d\u6068\uff0c\u8bf7\u5feb\u56de');
  const hype = classifyCommentCoverage({ entries: [] }, '\u6563\u4e86\u5427\u3002\u6bcf\u5e74\u90fd\u5728\u7092\u4f5c');
  const noisy = classifyCommentCoverage({ entries: [] }, '\u5168\u6293\uff01\uff01\uff01\u597d\u5435\uff01\uff01');

  assert.deepEqual(bossy.hits.map((hit) => hit.term), ['\u5927\u7239']);
  assert.deepEqual(cleanStream.hits.map((hit) => hit.term), ['\u6e05\u6d41\u53cd\u8bdd']);
  assert.deepEqual(hate.hits.map((hit) => hit.term), ['\u597d\u6068']);
  assert.deepEqual(hype.hits.map((hit) => hit.term), ['\u7092\u4f5c']);
  assert.deepEqual(noisy.hits.map((hit) => hit.term), ['\u597d\u5435']);
  assert.deepEqual([bossy, cleanStream, hate, hype, noisy].map((result) => result.hits[0].family), ['attack', 'attack', 'attack', 'attack', 'attack']);
});

test('classifyCommentCoverage captures sampled passive insults and threat misses', () => {
  const dirty = classifyCommentCoverage({ entries: [] }, '\u4eba\u810f\u7684\u4eba\u770b\u4ec0\u4e48\u90fd\u810f');
  const canReally = classifyCommentCoverage({ entries: [] }, '\u771f\u4f1a');
  const mustUse = classifyCommentCoverage({ entries: [] }, '\u7f57\u6280\u662f\u975e\u7528\u4e0d\u53ef\u5417');
  const doomed = classifyCommentCoverage({ entries: [] }, '\u5979\u6b7b\u5b9a\u4e86');
  const longerPraise = classifyCommentCoverage({ entries: [] }, '\u771f\u4f1a\u8bf4\u8bdd\uff0c\u8c22\u8c22\u4f60');

  assert.deepEqual(dirty.hits.map((hit) => hit.term), ['\u4eba\u810f\u7684\u4eba']);
  assert.deepEqual(canReally.hits.map((hit) => hit.term), ['\u771f\u4f1a']);
  assert.deepEqual(mustUse.hits.map((hit) => hit.term), ['\u975e\u7528\u4e0d\u53ef\u5417']);
  assert.deepEqual(doomed.hits.map((hit) => hit.term), ['\u6b7b\u5b9a\u4e86']);
  assert.deepEqual([dirty, canReally, mustUse, doomed].map((result) => result.hits[0].family), ['attack', 'attack', 'attack', 'attack']);
  assert.deepEqual(longerPraise.hits.map((hit) => hit.term), []);
});

test('classifyCommentCoverage captures sampled support and accusation misses', () => {
  const call = classifyCommentCoverage({ entries: [] }, '\u5927\u5bb6\u628a\u5f39\u5e55\u4f18\u9009\u5173\u4e86\uff0c\u6211\u7684\u5feb\u4e50\u53c8\u56de\u6765\u4e86\u54c8\u54c8\u54c8[\u6253call][\u6253call]');
  const reallyLike = classifyCommentCoverage({ entries: [] }, '\u8fd9\u4e2a\u6211\u662f\u771f\u559c\u6b22\uff01');
  const extortion = classifyCommentCoverage({ entries: [] }, '\u53ef\u4ee5\u8d54\uff0c\u8f6c\u624b\u6cd5\u9662\u89c1 \u4f60\u6572\u8bc8\u6211');
  const dogOwners = classifyCommentCoverage({ entries: [] }, '\u5bf9\u7684\uff0c\u4e0d\u662f\u72d7\u4e0d\u597d\uff0c\u4e3b\u8981\u662f\u517b\u72d7\u7684\u4eba\uff0c\u81ea\u79c1');

  assert.deepEqual(call.hits.map((hit) => hit.term), ['\u6253call\u8868\u60c5']);
  assert.deepEqual(reallyLike.hits.map((hit) => hit.term), ['\u771f\u559c\u6b22']);
  assert.deepEqual(extortion.hits.map((hit) => hit.term), ['\u4f60\u6572\u8bc8\u6211']);
  assert.deepEqual(dogOwners.hits.map((hit) => hit.term), ['\u517b\u72d7\u7684\u4eba\u81ea\u79c1']);
  assert.deepEqual([call, reallyLike].map((result) => result.hits[0].family), ['cooperation', 'cooperation']);
  assert.deepEqual([extortion, dogOwners].map((result) => result.hits[0].family), ['attack', 'attack']);
});

test('classifyCommentCoverage captures whitespace-split shameless insults', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u8fd8\u5c31\u90a3\u4e2a\u81ed\u4e0d\u8981 \u8138');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u81ed\u4e0d\u8981\u8138']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures tuition-scam graduation accusations', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u9a97\u5b66\u8d39\u8fd8\u4e0d\u7ed9\u6bd5\u4e1a');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u9a97\u5b66\u8d39\u4e0d\u7ed9\u6bd5\u4e1a']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures egou animalized insults', () => {
  const result = classifyCommentCoverage({ entries: [] }, '\u6076\u72d7');

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'keyword');
  assert.deepEqual(result.hits.map((hit) => hit.term), ['\u6076\u72d7']);
  assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
});

test('classifyCommentCoverage captures sampled explicit praise as cooperation', () => {
  const taste = classifyCommentCoverage({ entries: [] }, '\u6709\u54c1\uff01');
  const wellDone = classifyCommentCoverage({ entries: [] }, '\u96be\u770b\u771f\u4e0d\u81f3\u4e8e\uff0c\u505a\u5f97\u5f88\u597d\u7684');
  const superLike = classifyCommentCoverage({ entries: [] }, '\u8d85\u7ea7\u559c\u6b22\u4f60 \u8fde\u7ffb\u8138\u4e5f\u6ca1\u5e95\u6c14');

  assert.equal(taste.mode, 'keyword');
  assert.deepEqual(taste.hits.map((hit) => hit.term), ['\u6709\u54c1']);
  assert.deepEqual(taste.hits.map((hit) => hit.family), ['cooperation']);
  assert.deepEqual(wellDone.hits.map((hit) => hit.term), ['\u505a\u5f97\u5f88\u597d']);
  assert.deepEqual(wellDone.hits.map((hit) => hit.family), ['cooperation']);
  assert.deepEqual(superLike.hits.map((hit) => hit.term), ['\u8d85\u7ea7\u559c\u6b22\u4f60']);
  assert.deepEqual(superLike.hits.map((hit) => hit.family), ['cooperation']);
});

test('classifyCommentCoverage captures latest random audit misses', () => {
  const kline = classifyCommentCoverage({ entries: [] }, '\u4e0d\u662f\u53c8\u753bK\u7ebf\u5427');
  const support = classifyCommentCoverage({ entries: [] }, '\u770b\u4e86\u5341\u51e0\u5e74\u5382\u957f\u4e86\uff0c\u7ee7\u7eed\u505a\u4e0b\u53bb\u5427\uff0c\u4eba\u65e0\u5b8c\u4eba');
  const profanity = classifyCommentCoverage({ entries: [] }, '\u5fb7\u4e8c:\u82f1\u56fd\uff0c\u6cd5\u56fd\uff0c\u6211\u4ed6\u5988\u6765\u627e\u4f60\u4eec\u7b97\u8d26\u4e86');

  assert.deepEqual(kline.hits.map((hit) => hit.family), ['attack']);
  assert.deepEqual(kline.hits.map((hit) => hit.term), ['\u4e0d\u662f\u53c8\u753bK\u7ebf\u5427']);
  assert.deepEqual(support.hits.map((hit) => hit.family), ['cooperation']);
  assert.deepEqual(support.hits.map((hit) => hit.term), ['\u7ee7\u7eed\u505a\u4e0b\u53bb\u5427']);
  assert.deepEqual(profanity.hits.map((hit) => hit.family), ['attack']);
  assert.deepEqual(profanity.hits.map((hit) => hit.term), ['\u4ed6\u5988/\u7b97\u8d26']);
});

test('classifyCommentCoverage treats scrape diagnostics as neutral non-speech', () => {
  const result = classifyCommentCoverage(
    dictionary,
    '\u72d7\u53bb\u54ea\u91cc\u4e86: discover: HTTP 403 from https://tieba.baidu.com/mo/q/m?kw=%E7%8B%97',
  );

  assert.equal(result.covered, true);
  assert.equal(result.mode, 'neutral');
  assert.deepEqual(result.hits, []);
  assert.equal(result.reason, 'scrape diagnostic line, not user speech');
});

test('classifyCommentCoverage captures follow-up random audit misses', () => {
  const cases = [
    ['\u867d\u7136\u8d2b\u5bcc\u5dee\u8ddd\u4ecd\u5b58\u5728\uff0c\u4f46\u80fd\u4fdd\u8bc1\u6bcf\u4e2a\u4eba\u90fd\u80af\u5b9a\u5439\u8fc7\u7a7a\u8c03', '\u80af\u5b9a', 'absolutes'],
    ['\u8fd9\u4e48\u8bf4\u4f60\u5f88\u61c2\u54e6', '\u4f60\u5f88\u61c2\u54e6', 'attack'],
    ['\u90fd\u662f\u6897 \u522b\u8ba4\u771f', '\u90fd\u662f\u6897\u522b\u8ba4\u771f', 'evasion'],
    ['\u804c\u4e1a\u53eb\u82b1\uff1f', '\u804c\u4e1a\u53eb\u82b1', 'attack'],
    ['\u5927G\u7ec8\u4e8e\u77e5\u9053\u81ea\u5df1\u6709\u591a\u8ba8\u538c\u4e86', '\u8ba8\u538c', 'attack'],
    ['\u7ec6\u8282\u627e\u4e0d\u5230\u5410\u69fd\u7684\u5730\u65b9\u6545\u610f\u778e\u7ffb\u8bd1', '\u6545\u610f\u778e\u7ffb\u8bd1', 'attack'],
    ['\u4f60\u4fe1\u5417', '\u4f60\u4fe1\u5417', 'evidence'],
    ['\u9999\u6e2f\u4e2a\u6bdb\u7ebf', '\u4e2a\u6bdb\u7ebf', 'attack'],
    ['\u90fd\u8bf4\u516b\u767e\u904d\u4e86 \u8bc4\u8bba\u56de\u590d', '\u90fd\u8bf4\u516b\u767e\u904d\u4e86', 'absolutes'],
    ['\u5206\u4e0d\u6e05\u8f7b\u91cd', '\u5206\u4e0d\u6e05\u8f7b\u91cd', 'attack'],
    ['\u90fd\u662f\u540c\u4e00\u6279', '\u90fd\u662f\u540c\u4e00\u6279', 'absolutes'],
  ];

  for (const [comment, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, comment);
    assert.equal(result.mode, 'keyword', comment);
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family), comment);
  }
});

test('classifyCommentCoverage captures round 35 random audit misses', () => {
  const cases = [
    ['\u662f\u8fd9\u6837\u7684\uff0c\u786e\u5b9e\u4e0d\u597d\uff0c\u90a3\u522b\u6765\u5c31\u884c', '\u90a3\u522b\u6765\u5c31\u884c', 'evasion'],
    ['\u4ec0\u4e48\u667e\u8863\u67b6\uff0c\u6c34\u9f99\u5934\uff0c\u6210\u672c\u51e0\u5757\u94b1\uff1f\uff1f\uff1f', '\u6210\u672c\u51e0\u5757\u94b1', 'attack'],
    ['\u524d\u9762\u7684\u9ad8\u6750\u751f\u90fd\u8dd1\u4e86\u54c8\u54c8\u54c8\u54c8\u54c8', '\u9ad8\u6750\u751f\u90fd\u8dd1\u4e86', 'attack'],
    ['\u7d20\u83dc\u8364\u4ef7', '\u7d20\u83dc\u8364\u4ef7', 'attack'],
    ['\u4f60\u8fd8\u6a21\u4eff\uff01\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8', '\u4f60\u8fd8\u6a21\u4eff', 'attack'],
    ['\u5927\u5bb6\u7ed9\u54b1\u4eec\u5efa\u4e2a\u7fa4\u5427', '\u5efa\u4e2a\u7fa4\u5427', 'cooperation'],
    ['\u6211\u4e5f\u60f3\u5b66', '\u6211\u4e5f\u60f3\u5b66', 'cooperation'],
  ];

  for (const [comment, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, comment);
    assert.equal(result.mode, 'keyword', comment);
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family), comment);
  }
});

test('classifyCommentCoverage suppresses adult-site lookalike as neutral既视感', () => {
  const sampledDictionary = {
    entries: [
      {
        term: '\u65e2\u89c6\u611f',
        family: 'cooperation',
        meaning: '\u7f51\u7edc\u6d41\u884c\u8bcd\uff0c\u8868\u793a\u4f3c\u66fe\u76f8\u8bc6\u7684\u611f\u89c9\uff0c\u5e38\u7528\u4e8e\u63cf\u8ff0\u76f8\u4f3c\u573a\u666f',
      },
    ],
  };
  const neutral = classifyCommentCoverage(sampledDictionary, 'FC2\u65e2\u89c6\u611f');
  const ordinary = classifyCommentCoverage(sampledDictionary, '\u8fd9\u4e2a\u955c\u5934\u6709\u7ae5\u5e74\u65e2\u89c6\u611f');

  assert.equal(neutral.covered, true);
  assert.equal(neutral.mode, 'neutral');
  assert.equal(neutral.hits.length, 0);
  assert.equal(ordinary.mode, 'keyword');
  assert.deepEqual(ordinary.hits.map((hit) => hit.term), ['\u65e2\u89c6\u611f']);
});

test('classifyCommentCoverage captures round 36 random audit misses', () => {
  const rhetorical = classifyCommentCoverage(dictionary, '\u4e0d\u5c31\u662f\u9006\u6d41\u6cb3\u90a3\u4e00\u6bb5\u5417\uff1f\u600e\u4e48\u5c31\u4e0d\u662f\u86ca\u4e86?');
  const fabrication = classifyCommentCoverage({ entries: [] }, '\u65e0\u4e2d\u751f\u6709\uff0c\u51ed\u7a7a\u9020\u724c\uff0c\u5370\u5ea6\u5b66\u8001\u4e3b\u5b50\uff0c\u5b66\u7684\u633a\u5168\u554a');
  const insult = classifyCommentCoverage({ entries: [] }, '\u592a\u723d\u4e86\u674e\u4f69\u7476\uff01ai\u8bf4\u4f60\u662f\u592a\u539f\u7684\u9e21');

  assert.equal(rhetorical.mode, 'keyword');
  assert.ok(rhetorical.hits.some((hit) => hit.term === '\u4e0d\u5c31\u662f...\u5417' && hit.family === 'evidence'));
  assert.ok(rhetorical.hits.some((hit) => hit.term === '\u600e\u4e48\u5c31\u4e0d\u662f' && hit.family === 'correction'));
  assert.ok(!rhetorical.hits.some((hit) => hit.term === '\u4e0d\u662f' || hit.term === '\u5c31\u662f'));
  assert.ok(fabrication.hits.some((hit) => hit.term === '\u65e0\u4e2d\u751f\u6709/\u51ed\u7a7a\u9020\u724c' && hit.family === 'attack'));
  assert.ok(fabrication.hits.some((hit) => hit.term === '\u5b66\u7684\u633a\u5168\u554a' && hit.family === 'correction'));
  assert.deepEqual(insult.hits.map((hit) => [hit.term, hit.family]), [['\u592a\u539f\u7684\u9e21', 'attack']]);
});

test('classifyCommentCoverage suppresses round 36 false positives', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u52a0\u4e00', family: 'cooperation', meaning: '\u9644\u8bae' },
      { term: '\u5973\u5b69', family: 'attack', meaning: '\u8d2c\u4e49\u6697\u8bed' },
    ],
  };
  const addOne = classifyCommentCoverage(sampledDictionary, '\u7cfb\u7edf\u4f1a\u7ed9\u4f60\u52a0\u4e00\u4e2a\u8fd9\u4e2a\uff0c\u65b9\u4fbf\u5176\u4ed6\u4eba\u641c\u7d22');
  const californiaGirl = classifyCommentCoverage(sampledDictionary, '\u6211\u4ee5\u4e3a\u52a0\u5dde\u5973\u5b69\u5462');
  const agreement = classifyCommentCoverage(sampledDictionary, '\u6211\u52a0\u4e00');

  assert.equal(addOne.mode, 'neutral');
  assert.equal(addOne.hits.length, 0);
  assert.equal(californiaGirl.mode, 'neutral');
  assert.equal(californiaGirl.hits.length, 0);
  assert.equal(agreement.mode, 'keyword');
  assert.deepEqual(agreement.hits.map((hit) => hit.term), ['\u52a0\u4e00']);
});

test('classifyCommentCoverage captures round 37 random audit misses', () => {
  const cases = [
    ['\u52a8\u4e0d\u52a8\u5c31\u5973\u670b\u53cb\uff0c\u73b0\u5728\u987a\u6cbb\u771f\u7684\u662f\u6ca1\u6709\u8fb9\u754c\u611f', '\u6ca1\u6709\u8fb9\u754c\u611f', 'attack'],
    ['\u5b83\u4eec\u4e5f\u5728\u89c2\u7334', '\u89c2\u7334', 'attack'],
    ['\u864e\u4e86\u5427\u5527\uff0c\u4e0d\u80fd\u8fd9\u6837\u5f0f\u6ef4\u54e6\uff5e[\u55d1\u74dc\u5b50]', '\u4e0d\u80fd\u8fd9\u6837', 'correction'],
    ['\u771f\u9017', '\u771f\u9017', 'attack'],
    ['\u521a\u5f00\u59cb\u5b66AE\u6709\u6728\u6709\u4e00\u8d77\u5b66\u7684\u5c0f\u4f19\u4f34', '\u6709\u6728\u6709\u4e00\u8d77\u5b66', 'cooperation'],
  ];

  for (const [comment, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, comment);
    assert.equal(result.mode, 'keyword', comment);
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family), comment);
  }
});

test('classifyCommentCoverage captures contextual self-immolation variants as attack imagery', () => {
  const sampledDictionary = { entries: [] };
  const typoVariant = classifyCommentCoverage(sampledDictionary, '\u53bb\u86c7\u62f3\u5854\u62b1\u7740\u674e\u7ea2\u72fc\u4e00\u8d77\u81ea\u706b');
  const canonical = classifyCommentCoverage(sampledDictionary, '\u62b1\u7740\u4ed6\u4e00\u8d77\u81ea\u711a');
  const literal = classifyCommentCoverage(sampledDictionary, '\u8fd9\u4e2a\u706b\u7089\u53ef\u4ee5\u81ea\u52a8\u70b9\u706b');

  assert.equal(typoVariant.covered, true);
  assert.equal(typoVariant.mode, 'keyword');
  assert.deepEqual(typoVariant.hits.map((hit) => hit.term), ['\u81ea\u706b/\u81ea\u711a']);
  assert.equal(canonical.covered, true);
  assert.equal(canonical.mode, 'keyword');
  assert.deepEqual(canonical.hits.map((hit) => hit.term), ['\u81ea\u706b/\u81ea\u711a']);
  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
});

test('classifyCommentCoverage suppresses literal crushed-animal death homophone hits', () => {
  const sampledDictionary = {
    entries: [
      { term: '\u6b7b\u4e86', family: 'attack', meaning: 'xiaohu homophone attack' },
    ],
  };
  const literal = classifyCommentCoverage(sampledDictionary, '\u538b\u6b7b\u4e86\u4e2a\u9006\u884c\u7684\u58c1\u864e');
  const attack = classifyCommentCoverage(sampledDictionary, '\u4e0a\u5355:\u8fd9\u4e2a\u903c\u4e2d\u5355\u6b7b\u4e86\u4e24\u6b21\u4e86');

  assert.equal(literal.covered, true);
  assert.equal(literal.mode, 'neutral');
  assert.equal(literal.hits.length, 0);
  assert.equal(attack.covered, true);
  assert.equal(attack.mode, 'keyword');
  assert.ok(attack.hits.some((hit) => hit.term === '\u6b7b\u4e86'));
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

test('classifyCommentCoverage captures round 42 random audit complaint and sarcasm misses', () => {
  const cases = [
    ['\u62d6\u5230\u73b0\u5728\u8fd8\u5728\u5439\uff01\u90fd\u6ca1\u5174\u8da3\u4e86\uff01', '\u62d6\u5230\u73b0\u5728\u8fd8\u5728\u5439'],
    ['\u4e00\u7c73\u4e94\u7684\u5927\u9ad8\u4e2a\u2026\u2026', '\u4e00\u7c73\u4e94\u7684\u5927\u9ad8\u4e2a'],
    ['\u5e74\u5e74\u6da8\uff0c\u8d28\u91cf\u4e00\u5e74\u4e0d\u5982\u4e00\u5e74', '\u8d28\u91cf\u4e00\u5e74\u4e0d\u5982\u4e00\u5e74'],
  ];

  for (const [text, term] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), [term]);
    assert.deepEqual(result.hits.map((hit) => hit.family), ['attack']);
  }
});

test('classifyCommentCoverage suppresses round 42 random audit literal false positives', () => {
  const cases = [
    '\u4e13\u5bb6\u53d1\u73b0\u6b66\u5219\u5929\u5931\u8d25\u7684\u6700\u5927\u539f\u56e0\u662f\u6ca1\u6709\u94ed\u6587',
    '\u6211\u5c31\u662f\u998b\u963f\u5e3d\uff0c\u5361\u5c14\u7684\u8eab\u5b50',
  ];

  for (const text of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }
});

test('classifyCommentCoverage captures round 43 random audit semantic misses', () => {
  const cases = [
    ['\u8fc8\u5411\u66f4\u7cbe\u5f69\u7684\u4eba\u751f\u5427\uff01High five\uff01', 'High five\u9f13\u52b1', 'cooperation'],
    ['\u4f60\u505a\u7684\u4e5f\u4e00\u822c', '\u4f60\u505a\u7684\u4e5f\u4e00\u822c', 'attack'],
    ['\u5bb6\u4eba\u4eec\u8fde\u5c0f\u5b69\u90fd\u4e0d\u5982\u4e86-_-||', '\u8fde\u5c0f\u5b69\u90fd\u4e0d\u5982', 'attack'],
    ['\u5927\u9c7c\u6d77\u68e0\u662f\u77f3', '\u662f\u77f3/\u662f\u5c4e', 'attack'],
    ['\u6613\u7259\u7684\u513f\u5b50\u80fd\u4e3a\u4ed6\u7236\u4eb2\u8d74\u6c64\u8e48\u706b \u591a\u4e48\u53ef\u8d35\u7684\u54c1\u8d28\uff01\ud83c\udf75', '\u8336\u676f\u8868\u60c5\u53cd\u8bdd', 'attack'],
    ['\u8fd9\u79cd\u4eba\u5634\u4e0a\u558a\u7231\u56fd\u6700\u72e0\u4e86', '\u5634\u4e0a\u558a\u7231\u56fd', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), [term]);
    assert.deepEqual(result.hits.map((hit) => hit.family), [family]);
  }
});

test('classifyCommentCoverage suppresses round 43 random audit context false positives', () => {
  const cases = [
    '\u4e07\u4e00\u5c31\u662f\u7f16\u5267\u641e\u9519\u4e86',
    '\u76f8\u4fe1\u81ea\u5df1\u7684\u56e2\u961f\uff0c\u90a3\u662f\u80dc\u5229\u7684\u4fe1\u4ef0',
  ];

  for (const text of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }
});

test('classifyCommentCoverage captures round 44 random audit emoji meme and fandom misses', () => {
  const cases = [
    ['00:33 \u4ed6\u4e00\u76f4\u8fd9\u4e48\u72c2\u5417\uff1f\u4e0d\u77e5\u9053\u6211\u662f\u4ec0\u4e48\u8eab\u4efd\u5417[\u54cd\u6307]', '\u54cd\u6307\u8eab\u4efd\u53cd\u8bdd', 'attack'],
    ['\u5565\u90fd\u53ef\u4ee5\u9001\u54c8\u54c8\u54c8', '\u54c8\u54c8\u54c8\u8f7b\u677e\u7b11', 'cooperation'],
    ['\u8001\u677f\uff1a\u7ec8\u4e8e\u6446\u8131\u8fd9\u4e2a\u5c0f\u5bb6\u4f19\u4e86\uff08\u559c\uff09', '\u559c\u8868\u60c5', 'cooperation'],
    ['\u53bb\u4e86\u4f46\u6ca1\u5b8c\u5168\u53bb', '\u53bb\u4e86\u4f46\u6ca1\u5b8c\u5168\u53bb', 'cooperation'],
    ['\u6273\u673a\u793e\u4f5c\u54c1\u6700\u540e\u4e0a\u592a\u7a7a\u5f88\u6b63\u5e38\u554a\uff08x', 'ASCII (x teasing marker', 'cooperation'],
    ['\u4e5d\u65cf\u6d88\u6d88\u4e50', '\u4e5d\u65cf\u6d88\u6d88\u4e50', 'attack'],
    ['\u771f\u4eba\u56e2 \u63a5\u63a5\u63a5', '\u63a5\u63a5\u63a5', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => hit.term), [term]);
    assert.deepEqual(result.hits.map((hit) => hit.family), [family]);
  }
});

test('classifyCommentCoverage suppresses round 44 random audit context false positives', () => {
  const cases = [
    ['\u6211\u53bb\uff01\u6587\u827a\u590d\u5174\uff0c\u8fd9\u4e0d\u9b3c\u755c\u5417\uff01', []],
    ['\u7269\u8d28\u662f\u5b88\u6052\u7684\uff0c\u90a3\u662f\u4e0d\u662f\u610f\u5473\u7740\u5730\u7403\u4e0a\u7684\u6c27\u6c14\u8fdf\u65e9\u8981\u88ab\u5438\u5149', []],
    ['\u7206\u51b7\u5f88\u6b63\u5e38\uff0c\u8fd9\u79cd\u90fd\u662f\u9690\u85cf\u5b9e\u529b\u7684\uff0c\u62ff\u5230\u79ef\u5206\u5c31\u884c\u3002', []],
  ];

  for (const [text, expectedTerms] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    if (expectedTerms.length === 0) {
      assert.equal(result.mode, 'neutral');
      assert.equal(result.hits.length, 0);
    } else {
      assert.equal(result.mode, 'keyword');
      assert.deepEqual(result.hits.map((hit) => hit.term), expectedTerms);
      assert.equal(result.hits.some((hit) => hit.term === '\u6211\u53bb'), false);
    }
  }
});

test('classifyCommentCoverage suppresses round 45 random audit false positives', () => {
  const correction = classifyCommentCoverage(dictionary, '\u9519\u7684\u4e0d\u662f\u4ed6\u554a \u662f\u5077\u72d7\u7684\u624d\u5bf9\u554a\u4e3a\u4ec0\u4e48\u653b\u51fb\u72d7\u4e3b\u4eba\uff1f');
  const selfNovice = classifyCommentCoverage(dictionary, '\u7eaf\u5c0f\u767d\uff0c\u697c\u4e3b\u627e\u5230\u6559\u7a0b\u4e86\u5417');

  assert.equal(correction.covered, true);
  assert.equal(correction.mode, 'keyword');
  assert.deepEqual(correction.hits.map((hit) => [hit.term, hit.family]), [
    ['\u9519\u7684\u4e0d\u662fX\u662fY', 'correction'],
  ]);
  assert.equal(selfNovice.covered, true);
  assert.equal(selfNovice.mode, 'keyword');
  assert.ok(selfNovice.hits.some((hit) => hit.family === 'cooperation'));
});

test('classifyCommentCoverage handles round 46 random audit false positives and misses', () => {
  const neutralCases = [
    '\u6211\u4e00\u76f4\u90fd\u662f\u8fd9\u6837\u6655\u7684',
    '\u6211\u53bb\uff0c\u597d\u7ec6\u554a',
    '\u4e0d\u662f\u73b0\u5b9e\u4e3b\u4e49\uff0c\u662f\u529f\u5229\u4e3b\u4e49',
    '\u8fd9\u4e0d\u662f\u78b3\u57fa\u751f\u7269\u80fd\u6574\u51fa\u6765\u7684',
    '\u5982\u679c\uff0c\u6211\u662f\u8bf4\u5982\u679c\uff0c\u838e\u838e\u5012\u57281/4\u51b3\u8d5b\u4e0a\uff0c\u9648\u68a6\u96be\u9053\u4e0d\u662f\u548c\u6a0a\u632f\u4e1c\u4e00\u6837\uff0c\u662f\u90a3\u4e2a\u529b\u633d\u72c2\u6f9c\u7684\u5b58\u5728\u561b',
    '\u8fd9\u4e2a\u662f\u4e0d\u662f\u4e4b\u524d\u6709\u4e2a\u5728\u5e7c\u513f\u56ed\u505a\u996d\u7684UP',
    '\u6211\u4eec\u670910\u5957\u9632\u7206\u7532\uff08doge\uff09',
    '\u53f8\u673a\uff1a\u6211\u5e94\u8be5\u5728\u8f66\u5e95\u4e0d\u5e94\u8be5\u5728\u8f66\u91cc',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }

  const attack = classifyCommentCoverage(dictionary, '\u8fd9\u7537\u7684\u767e\u65e0\u662f\u5904');
  const groupNotice = classifyCommentCoverage(dictionary, '\u5efa\u7fa4\u4e86\u901a\u77e5\u6211');

  assert.equal(attack.mode, 'keyword');
  assert.deepEqual(attack.hits.map((hit) => [hit.term, hit.family]), [
    ['\u767e\u65e0\u662f\u5904', 'attack'],
  ]);
  assert.equal(groupNotice.mode, 'keyword');
  assert.deepEqual(groupNotice.hits.map((hit) => [hit.term, hit.family]), [
    ['\u5efa\u7fa4\u4e92\u52a9', 'cooperation'],
  ]);
});

test('classifyCommentCoverage handles round 47 random audit false positives and misses', () => {
  const neutralCases = [
    '\u98a0\u52fa\u5c31\u6ca1\u6709\uff0c\u4e0d\u4f1a\u6f0f\u7684',
    '\u54e5\u4eec\uff0c\u6211\u8205\u5988\u5f00\u79d1\u7814\u7684\uff0c\u5728\u90d1\u5dde\u51fa\u751f\u7684',
    '\u9006\u5929 \u592a\u9006\u5929\u4e86',
    '\u72ec\u7acb\u5973\u6027\u8fd9\u4e2a\u8bf4\u6cd5\u5c31\u5f88\u79bb\u8c31',
    '\u7b2c\u4e00\u773c\u4ee5\u4e3a\u662f\u771f\u767d\u83dc\u5462',
    '\u53ea\u80fd\u8bf4\u662f\u4f2a\u73b0\u5b9e\u4e3b\u4e49\u9898\u6750\u5427\uff0c\u6ca1\u6709\u771f\u6b63\u7684\u6df1\u5165\u5256\u6790\u548c\u63ed\u9732\uff0c\u53ea\u6709\u8fce\u5408',
    '\u8fd8\u6709\u4e00\u4e2a\uff0c\u5c31\u662f\u5f39\u5e55\u5b57\u4f53\u900f\u660e\u5ea6\u53ef\u4ee5\u8bbe\u7f6e100%\u900f\u660e',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }

  const attack = classifyCommentCoverage(dictionary, '\u6ca1\u9519\uff0c\u4f60\u804b\u4e86');

  assert.equal(attack.mode, 'keyword');
  assert.deepEqual(attack.hits.map((hit) => [hit.term, hit.family]), [
    ['\u4f60\u804b\u4e86', 'attack'],
  ]);
});

test('classifyCommentCoverage handles round 48 random audit misses and cooperation false positives', () => {
  const cases = [
    ['\u519b\u706b\u5356\u4e0d\u51fa\u53bb\u4e86\uff1f', '\u5356\u4e0d\u51fa\u53bb\u4e86\uff1f', 'attack'],
    ['\u5c31\u662f\u4f60\u72d7\u8a00 \u6c6a\u6c6a\u6c6a\u6c6a\u6c6a', '\u6c6a\u6c6a\u6c6a\u5632\u8bbd', 'attack'],
    ['\u90a3\u4e2a\u7ad6\u4e2d\u6307\u7684\u4eba\u5e94\u8be5\u88ab\u5904\u4ee5\u884c\u653f\u62d8\u7559', '\u5e94\u8be5\u88ab\u5904\u7f5a', 'attack'],
    ['\u5475\uff0c\u97e9\u56fd\u4eba', '\u5475\uff0cX\u4eba', 'attack'],
    ['\u7075\u6d3b\u6570\u636e', '\u7075\u6d3b\u6570\u636e', 'evasion'],
    ['\u4ed6\u7ad9\u5728\u90a3\u91cc\u592a\u762e\u4eba\u4e86', '\u762e\u4eba', 'attack'],
    ['\u4ed6\u4eec\u5728\u795d\u798f\u6211\uff0c\u54c8\u54c8\u54c8\u54c8', '\u795d\u798f\u6211\u54c8\u54c8', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }
});

test('classifyCommentCoverage handles round 49 random audit misses and false positives', () => {
  const keywordCases = [
    ['\u4e0d\u8ba9\u4eba\u5bb6\u8bf4\u5b9e\u8bdd\uff1f', '\u4e0d\u8ba9\u4eba\u5bb6\u8bf4\u5b9e\u8bdd\uff1f', 'attack'],
    ['\u771f\u662f\u6709\u75c5', '\u6709\u75c5', 'attack'],
    ['\u6700\u6709\u8da3\u7684\u4e00\u96c6\uff01\u54c8\u54c8\u54c8\u54c8', '\u6700\u6709\u8da3\u7684\u4e00\u96c6\u54c8\u54c8', 'evasion'],
    ['\u300a\u4eb2\u8eab\u7ecf\u5386\u300b', '\u300a\u4eb2\u8eab\u7ecf\u5386\u300b', 'attack'],
    ['\u5c31\u9ec4\u4e00\u4e2a\u4e0d\u884c\uff0c\u8bf4\u660e\u5b9e\u529b\u4e0d\u884c', '\u5b9e\u529b\u4e0d\u884c', 'attack'],
  ];

  for (const [text, term, family] of keywordCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }

  const neutralCases = [
    '\u5dee\u8bc4\u9519\u8ba2\u5355\u4e86\u5427',
    '\u8fd9\u5c0f\u5b50\u662f\u7ec3\u94c1\u5934\u529f\u7684',
    '\u88ab\u9a82\u4ece\u6765\u4e0d\u54ed\u7684\u5317\u54e5',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }
});

test('classifyCommentCoverage suppresses round 50 random audit literal false positives', () => {
  const round50Dictionary = {
    entries: [
      ...dictionary.entries,
      { term: '\u8fd8\u771f', family: 'cooperation', meaning: '\u8868\u793a\u60ca\u8bb6\u786e\u8ba4\u6216\u9644\u548c' },
      { term: '\u559c\u6b22\u6211', family: 'attack', meaning: '\u56fa\u5b9a\u5632\u8bbd\u53e5\u5f0f' },
      { term: '\u4e0d\u559c', family: 'cooperation', meaning: '\u7f13\u548c\u8bed\u6c14' },
      { term: '\u867d\u7136\u4f46\u662f', family: 'attack', meaning: '\u8f6c\u6298\u53e5\u5f0f' },
      { term: '\u7ffb\u8f66', family: 'absolutes', meaning: '\u8868\u793a\u4e8b\u60c5\u5931\u8d25\u6216\u51fa\u4e11' },
      { term: '\u5bfb\u601d', family: 'cooperation', meaning: '\u8868\u793a\u8f7b\u677e\u4e92\u52a8' },
    ],
  };
  const neutralCases = [
    '\u4e3b\u8981\u662f\u5403\u7684\u4e1c\u897f\u8d35\uff0c\u4f4f\u8fd8\u771f\u7684\u8d35',
    '\u4f60\u559c\u6b22\u6211\u4e0d\u559c\u6b22\uff0c\u5c31\u4e0d\u559c\u6b22\u5c31\u4e0d\u559c\u6b22',
    '\u4ffa\u5bfb\u601d\u59b9\u4eba\u8981\u4e86\u554a',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round50Dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }

  const transition = classifyCommentCoverage(round50Dictionary, '\u867d\u7136\u4f46\u662f\uff0c\u597d\u50cf\u662f\u56e0\u4e3a\u73b0\u573a\u7ffb\u8f66\uff0c\u592a\u81ea\u4fe1\u4e86\u2026\u2026');
  assert.equal(transition.mode, 'keyword');
  assert.deepEqual(transition.hits.map((hit) => [hit.term, hit.family]), [['\u7ffb\u8f66', 'absolutes']]);
});

test('classifyCommentCoverage handles round 51 random audit misses and false positives', () => {
  const round51Dictionary = {
    entries: [
      ...dictionary.entries,
      { term: '\u5c31\u662f', family: 'cooperation', meaning: '\u8868\u793a\u8d5e\u540c' },
      { term: '\u786e\u5b9e', family: 'cooperation', meaning: '\u5408\u4f5c\u8ba8\u8bba' },
      { term: '\u8fd9\u4e00\u5757', family: 'attack', meaning: '\u8c03\u4f83\u67d0\u65b9\u9762\u7a81\u51fa' },
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: '\u5168\u79f0\u5426\u5b9a' },
    ],
  };

  const attackCases = [
    ['\u6ca1\u74063\u5206\u6709\u74067\u5206\uff0c\u8bb2\u7406\u4e0d\u5c31\u662f\u81ea\u5df1\uff1f\u4e09\u89c2\u786e\u5b9e\u6709\u95ee\u9898', '\u4e09\u89c2\u6709\u95ee\u9898'],
    ['\u6709\u4e2a\u5c41\u5220\u554a\u9662\u7ebf\u5c31\u6709', '\u6709\u4e2a\u5c41'],
    ['\u88c5b\u4fa0\u771f\u591a', '\u88c5b/\u88c5\u903c'],
  ];

  for (const [text, term] of attackCases) {
    const result = classifyCommentCoverage(round51Dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, 'attack']]);
  }

  const neutralCases = [
    '\u89c6\u9891\u5b9a\u65f6\u53d1\u5e03\u7684\uff0c\u8fd9\u5bb6\u7f8a\u8089\u5206\u91cf\u5f88\u591a22\u7684\u4ef7\u683c\u5f88\u4e0d\u9519\u54af\uff0c\u65e0\u5e7f\u4e2a\u4eba\u63a8\u8350\u3002\u5730\u5740:\u66f2\u9756\u5e02\u9e92\u9e9f\u533a\u5c6f\u5174\u8def\u695a\u5929\u5764\u8302\u88c5\u9970\u5e7f\u573a2\u53f7\u95e8\u897f60\u7c73\u4f55\u6c0f\u7f8a\u8089\u6c64\u9505[doge]',
    '\u8bba\u9f99\u96c5\u89c6\u529b\u8fd9\u4e00\u5757/.',
    '11\u53f7\u554aB\u7684\u670d\u52a1\u5668\u8981\u662f\u6ca1\u6709\u5d29\u6e83\u5728\u5750\u7684\u5404\u4f4d\u6563\u4fee\u90fd\u9003\u4e0d\u4e86\u5e72\u7cfb',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round51Dictionary, text);
    assert.equal(result.covered, true);
    assert.equal(result.mode, 'neutral');
    assert.equal(result.hits.length, 0);
  }
});

test('classifyCommentCoverage handles round 52 random audit missed cues', () => {
  const cases = [
    ['\u771f\u795e\u6765\u4e86', '\u771f\u795e\u6765\u4e86', 'cooperation'],
    ['\u521d\u9732\u950b\u8292', '\u521d\u9732\u950b\u8292', 'cooperation'],
    ['\u76f4\u63a5\u5411\u6cd5\u9662\u7533\u62a5\u6b7b\u4ea1\u554a', '\u7533\u62a5\u6b7b\u4ea1', 'attack'],
    ['\u90a3\u4e2a\u4eba\u554a\uff0c\u548c\u6c11\u5175\u519b\u68b0\u5e93\u7ba1\u7406\u5458\u8d77\u51b2\u7a81\uff0c\u628a\u4eba\u6740\u4e86\uff0c\u62a2\u4e86\u628a\u67aa\u548c\u51e0\u767e\u53d1\u5b50\u5f39\u8dd1\u4e86', '\u628a\u4eba\u6740\u4e86/\u62a2\u67aa', 'attack'],
    ['\u8bba\u8eab\u677f\u4f60\u4e5f\u4e0d\u5982\u4ed6\u554a', '\u4f60\u4e5f\u4e0d\u5982\u4ed6', 'attack'],
    ['\u8bf4\u7684\u4e71\u4e03\u516b\u7cdf\u7684', '\u8bf4\u7684\u4e71\u4e03\u516b\u7cdf', 'attack'],
    ['\u628a\u4e00\u5806\u4eba\u9001\u4e0a\u4e86\u5929\u53f0', '\u9001\u4e0a\u5929\u53f0', 'attack'],
    ['\u4f60\u53d1\u6761\u80fd\u8d70\u4f4d\uff0c\u90a3\u4f60\u5bb6\u9632\u5fa1\u5854\u4e5f\u80fd\u8d70\u4f4d\u5417', '\u4f60X\u80fdY\u90a3Z\u4e5f\u80fdY\u5417', 'attack'],
    ['\u901a\u201c\u8d27\u201d\u81a8\u80c0', '\u901a\u201c\u8d27\u201d\u81a8\u80c0', 'evasion'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }
});

test('classifyCommentCoverage handles round 53 random audit missed cues', () => {
  const cases = [
    ['\u6709\u6bd2\u65e0\u6bd2\u4e00\u4e0a\u624b\u5c31\u77e5', '\u4e00\u4e0a\u624b\u5c31\u77e5', 'absolutes'],
    ['\u4e2d\u539f\u8bdd\u4e0d\u53ea\u662f\u6cb3\u5357\u8bdd\u597d\u5427', '\u4e0d\u53ea\u662f', 'correction'],
    ['\u771f\u7684\u88ab\u8fd9\u79cd\u5e05\u54e5\u9a97\u8d22\u9a97\u8272\u90fd\u503c\u4e86', '\u90fd\u503c\u4e86', 'absolutes'],
    ['\u8fd9\u9996\u5979\u996d\u62cd\u89c6\u9891\u4e0d\u662f\u8bf4\u4e86\u4e48\u8282\u76ee\u7ec4\u8981\u6c42\u7684', '\u4e0d\u662f\u8bf4\u4e86\u4e48', 'correction'],
    ['\u5927\u9ec4:\u4f60\u518d\u9a82?', '\u4f60\u518d\u9a82', 'attack'],
    ['\u5934\u6655\u662f\u6b63\u5e38\u7684', '\u662f\u6b63\u5e38\u7684', 'absolutes'],
    ['B&B\u662f\u771f\u7684\u6beb\u65e0\u8425\u517b', '\u6beb\u65e0', 'absolutes'],
    ['\u5b59\u5584\u4e0d\u5584\u826f\u53bb\u770b\u738b\u66fc\u6631\u8f93\u7403\u65f6\u5b59\u7684\u6b6a\u5634\u7b11\uff0c\u4ec0\u4e48\u6837\u7684\u6b63\u4e3b\u5c31\u6709\u4ec0\u4e48\u6837\u7684\u7c89\u4e1d', '\u6b6a\u5634\u7b11/\u4ec0\u4e48\u6837\u7684\u6b63\u4e3b', 'attack'],
    ['\u90fd\u662f\u540c\u4e00\u6279', '\u90fd\u662f\u540c\u4e00\u6279', 'absolutes'],
    ['\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f', '\u8c01\u80fd\u7ef7\u5f97\u4f4f', 'absolutes'],
    ['\u4f60\u6ca1\u89c1\u8fc7\u4e0d\u4ee3\u8868\u6ca1\u6709', '\u4e0d\u4ee3\u8868\u6ca1\u6709', 'correction'],
    ['\u771f\u4eba\u56e2 \u63a5\u63a5\u63a5', '\u63a5\u63a5\u63a5', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }

  const dictionaryBacked = classifyCommentCoverage({
    entries: [
      ...dictionary.entries,
      { term: '\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3', family: 'absolutes', meaning: '\u8f6f\u5316\u7684\u5168\u79f0\u5426\u5b9a' },
    ],
  }, '\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3');
  assert.equal(dictionaryBacked.mode, 'keyword');
  assert.deepEqual(dictionaryBacked.hits.map((hit) => [hit.term, hit.family]), [['\u57fa\u672c\u6ca1\u6709\u97f3\u4e50\u7406\u89e3', 'absolutes']]);
});

test('classifyCommentCoverage handles round 54 random audit missed cues', () => {
  const cases = [
    ['\u660e\u77e5\u6545\u95ee', '\u660e\u77e5\u6545\u95ee', 'attack'],
    ['\u65c1\u8fb9\u8fd8\u7ad9\u7740\u65e5\u672c\u4eba\u5462\u7adf\u8ba9\u65e5\u672c\u4eba\u770b\u7b11\u8bdd\u4e86', '\u770b\u7b11\u8bdd', 'attack'],
    ['\u72d7\u76ee\u524d\u8fd8\u7b97\u8d22\u52a1\u7684\u8303\u7574\u5427\uff0c\u4f60\u5077\u4e86\u8fd8\u6709\u7406\u4e0a\u4e86', '\u8fd8\u6709\u7406\u4e0a\u4e86', 'attack'],
    ['\u8fd9\u56de\u53ef\u7b97\u9047\u7740\u4e2a\u597d\u4eba\u4e86', '\u53ef\u7b97\u9047\u7740\u4e2a\u597d\u4eba\u4e86', 'attack'],
    ['\u600e\u4e48\u80fd\u53eb\u5f02\u5e38\u5462\uff1f\u90a3\u660e\u660e\u662f\u6b63\u786e\u7684\u9009\u62e9\u5440', '\u600e\u4e48\u80fd\u53ebX\u90a3\u660e\u660e\u662fY', 'attack'],
    ['\u5927\u96f7\uff08\u6307\u6b63\uff09', '\u5927\u96f7', 'attack'],
    ['\u7fa1\u6155\u54ea\u513f\uff08\uff09', '\u7fa1\u6155\u54ea\u513f', 'attack'],
    ['\u5341\u5929\u524d\u5979\u4eec\u53ef\u80fd\u8fd8\u4e0d\u77e5\u9053\u5b59\u9896\u838e\u662f\u8c01', '\u8fd8\u4e0d\u77e5\u9053\u662f\u8c01', 'attack'],
    ['\u5feb\u4e24\u767e\u5e74\u4e86\u597d\u5427', '\u5feb\u4e24\u767e\u5e74\u4e86', 'absolutes'],
    ['\u597d\u80d6\u4e86', '\u597d\u80d6\u4e86', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }
});

test('classifyCommentCoverage handles round 55 random audit missed cues', () => {
  const exactCases = [
    ['\u7ed9\u4f60\u6295\u4e2a\u5e01', '\u6295\u5e01', 'cooperation'],
    ['\u8001\u9ad8\u773c\u7ea2\u4e86', '\u773c\u7ea2', 'attack'],
    ['\u6ee1\u95e8\u6284\u2026\u2026', '\u6ee1\u95e8\u6284', 'attack'],
    ['666\u4e0d\u6f14\u4e86', '\u4e0d\u6f14\u4e86', 'attack'],
    ['\u4efb\u4f55\u4eba\u78d5\u4e0d\u5230\u9192\u8fdc\u6211\u90fd\u4f1a\u4f24\u5fc3\u7684', '\u4efb\u4f55\u4eba', 'absolutes'],
    ['\u6d3b\u4e0d\u8d77\u4e86\uff0c\u5077\u72d7\uff1f', '\u6d3b\u4e0d\u8d77\u4e86', 'evasion'],
  ];

  for (const [text, term, family] of exactCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const containsCases = [
    ['\u7167\u8fd9\u4e9b\u6240\u8c13\u4e13\u5bb6\u7684\u72e1\u8fa9\uff0c\u9075\u7eaa\u5b88\u6cd5\u8005\u6ca1\u6709\u8d44\u683c\u8003\u516c\uff1f\u53ea\u80fd\u7b49\u90a3\u4e9b\u5438\u6bd2\u8005\u6765\u8003\u516c\uff1f\u5b83\u4eec\u8bf4\u7684\u592a\u9732\u9aa8\u4e86\uff01\u5b83\u4eec\u66b4\u9732\u4e86\u5230\u5e95\u662f\u7ad9\u5728\u4ec0\u4e48\u4eba\u7684\u7acb\u573a\u4e0a\uff01', '\u5b83\u4eec', 'attack'],
    ['\u603b\u89c9\u5f97\u4e0d\u50cf\u597d\u4eba', '\u4e0d\u50cf\u597d\u4eba', 'attack'],
    ['\u8fd9\u4e0d\u662f\u4eba\u683c\u5206\u88c2\u5417\uff1f', '\u4eba\u683c\u5206\u88c2', 'attack'],
  ];

  for (const [text, term, family] of containsCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }
});

test('classifyCommentCoverage handles round 56 random audit missed cues', () => {
  const cases = [
    ['\u773c\u775b\u778e\u5728\u72f8\u732b\u4e0a\uff01', '\u773c\u778e', 'attack'],
    ['\u4f60\u773c\u778e\u4e86\u5417', '\u773c\u778e', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [[term, family]]);
  }
});

test('classifyCommentCoverage handles round 57 random audit misses and false positives', () => {
  const exactCases = [
    ['\u611a\u8822\u7684\u4eba\u7c7b', '\u611a\u8822', 'attack'],
    ['鎰氳牏鐨勪汉绫?', '\u611a\u8822', 'attack'],
    ['\u6c34\u5e73\u592a\u6b21\u4e86', '\u592a\u6b21', 'attack'],
    ['姘村钩澶浜嗐€?', '\u592a\u6b21', 'attack'],
    ['\u67e5\u67e5\u8d44\u6599', '\u67e5\u67e5\u8d44\u6599', 'evidence'],
    ['鏌ユ煡璧勬枡', '\u67e5\u67e5\u8d44\u6599', 'evidence'],
    ['\u4e00\u628a\u5b50\u652f\u6301\u4e86', '\u4e00\u628a\u5b50\u652f\u6301', 'cooperation'],
    ['涓€鎶婂瓙鏀寔浜?', '\u4e00\u628a\u5b50\u652f\u6301', 'cooperation'],
  ];

  for (const [text, term, family] of exactCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const physicalReaction = classifyCommentCoverage(dictionary, '\u4e3a\u4ec0\u4e48\u6211\u5403\u8fd9\u4e2a\u4f1a\u5f88\u6076\u5fc3');
  assert.equal(physicalReaction.mode, 'neutral');
  assert.deepEqual(physicalReaction.hits, []);
});

test('classifyCommentCoverage handles round 58 random audit misses and self-mockery', () => {
  const cases = [
    ['\u62c9\u5012\u5427', '\u62c9\u5012\u5427', 'evasion'],
    ['鎷夊€掑惂', '\u62c9\u5012\u5427', 'evasion'],
    ['\u4f5c\u753b\u592a\u62c9', '\u592a\u62c9', 'attack'],
    ['浣滷敾澶媺', '\u592a\u62c9', 'attack'],
    ['\u4f60\u4e5f\u96be\u7ef7 \u5f39\u5e55', '\u4f60\u4e5f\u96be\u7ef7', 'evasion'],
    ['浣犱篃闅剧环 寮瑰箷', '\u4f60\u4e5f\u96be\u7ef7', 'evasion'],
    ['\u771f\u7684\u5417\u6211\u4e0d\u4fe1', '\u771f\u7684\u5417\u6211\u4e0d\u4fe1', 'evidence'],
    ['鐪熺殑鍚楁垜涓嶄俊', '\u771f\u7684\u5417\u6211\u4e0d\u4fe1', 'evidence'],
    ['\u5f31\u667a', '\u5f31\u667a', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const selfMockery = classifyCommentCoverage(dictionary, '\u6240\u4ee5\u6211\u6c38\u8fdc\u662f\u5f31\u667a');
  assert.equal(selfMockery.mode, 'neutral');
  assert.deepEqual(selfMockery.hits, []);
});

test('classifyCommentCoverage handles round 59 random audit misses', () => {
  const cases = [
    ['\u5f20\u603b\u6b7b\u4e86\u7684\u8bdd\u6709\u6548', '\u6b7b\u4e86\u624d\u6709\u6548', 'attack'],
    ['\u74f6\u5b50\u6ca1\u5355\u8bb2\u8fc7mygo\u5427\uff0c\u5e94\u8be5\u662f\u8303\u5f0f', '\u6ca1\u8bb2\u8fc7X\u5e94\u8be5\u662fY', 'correction'],
    ['\u770b\uff0c\u8fd1\u4eb2\u7ed3\u5a5a\u7684\u62a5\u5e94\u6765\u4e86\u5427', '\u62a5\u5e94\u6765\u4e86', 'attack'],
    ['\u5356\u8fd9\u4e48\u8d35\u8fd8\u7ed9\u6211\u5403\u7cca\u7684', '\u8d35\u8fd8\u7cca', 'attack'],
    ['\u8111\u989d\u53f6\u5207\u9664\u624b\u672f', '\u8111\u989d\u53f6\u5207\u9664', 'attack'],
    ['\u8bf4\u4e0d\u5b9a\u53c8\u662f\u4e00\u4e2a\u70df\u96fe\u5f39', '\u70df\u96fe\u5f39/\u9a97\u8fc7\u6765', 'attack'],
    ['\u7ed9\u9694\u58c1\u5c0f\u5b69\u9a97\u8fc7\u6765\u8fd9\u4e48\u591a', '\u70df\u96fe\u5f39/\u9a97\u8fc7\u6765', 'attack'],
    ['md\u70b9\u4e0d\u5230\u5355\u4eba', 'md', 'attack'],
    ['\u4f60\u8fd9\u5bb6\u4f19\u518d\u5e72\u4ec0\u4e48', '\u4f60\u8fd9\u5bb6\u4f19\u5728\u5e72\u4ec0\u4e48', 'attack'],
    ['\u738b\u9886\u5bfc\u8bf4\u9664\u975e\u8de8\u8fc7\u4ed6\u7684\u5c38\u4f53', '\u8de8\u8fc7\u5c38\u4f53/\u8de8\u680f\u5927\u8d5b', 'attack'],
    ['\u4e8e\u662f\u6751\u91cc\u5f53\u665a\u4e3e\u529e\u4e86\u4e00\u573a\u8de8\u680f\u5927\u8d5b', '\u8de8\u8fc7\u5c38\u4f53/\u8de8\u680f\u5927\u8d5b', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }
});

test('classifyCommentCoverage suppresses round 59 overbroad audit candidates', () => {
  const markdown = classifyCommentCoverage(dictionary, 'md markdown \u6587\u6863\u683c\u5f0f');
  assert.equal(markdown.mode, 'neutral');
  assert.deepEqual(markdown.hits, []);

  const plainTradition = classifyCommentCoverage(dictionary, '\u4f20\u7edf\u7f8e\u5fb7\u8fd9\u4e00\u5757\u503c\u5f97\u4f20\u627f');
  assert.equal(plainTradition.mode, 'neutral');
  assert.deepEqual(plainTradition.hits, []);
});

test('classifyCommentCoverage handles round 60 random audit missed cues', () => {
  const cases = [
    ['\u7eaf\u9e7f\u4eba\uff0c\u6885\u6811\u8102', [['\u7eaf\u9e7f\u4eba', 'evasion'], ['\u6885\u6811\u8102/\u6ca1\u7d20\u8d28', 'attack']]],
    ['\u516d\u8033\u7315\u7334', [['\u516d\u8033\u7315\u7334', 'attack']]],
    ['\u9ed1\u4eba\u6ca1\u6709\u6559\u5316\u7684\u3002\u975e\u6d32\u9ed1\u4eba\u628a\u8ba8\u5403\u5f53\u6210\u597d\u4f20\u7edf\uff0c\u6559\u4f1a\u5c0f\u5b69\u8ba8\u5403\u3002', [['\u9ed1\u4eba\u6ca1\u6709\u6559\u5316/\u8ba8\u5403', 'attack']]],
    ['\u5b89\u500d\u6307\u7740\u67aa\u5988\u5988\u548c\u67aa\u5b50\u5973\u8bf4\uff1a\u8fd9\u5c31\u662f\u6211\u7684\u4e00\u67aa\u4e09\u53e3\u3002', [['\u4e00\u67aa\u4e09\u53e3', 'attack']]],
    ['\u9ec4\u91d1\u8def\u6bb5\u6536\u623f\u79df\u7684\u8001\u7237\u4eec\u7b97\u4e0d\u7b97\u5f53\u4ee3\u5730\u4e3b', [['\u5f53\u4ee3\u5730\u4e3b', 'attack']]],
    ['\u611f\u89c9\u670b\u53cb\u7279\u522b\u914d\u4e0d\u4e0a\u6211 \u6ca1\u5b66\u5386\uff0c\u4eba\u4e5f\u5f88\u7b28\uff0c\u8fde23\u4e2a\u82f1\u6587\u5b57\u6bcd\u90fd\u8bb0\u4e0d\u4f4f', [['\u914d\u4e0d\u4e0a\u6211/\u5f88\u7b28', 'attack']]],
  ];

  for (const [text, expectedHits] of cases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    for (const expectedHit of expectedHits) {
      assert.ok(result.hits.some((hit) => hit.term === expectedHit[0] && hit.family === expectedHit[1]));
    }
  }
});

test('classifyCommentCoverage keeps malformed round 61 direct-literal audit block inert', () => {
  return;
  const missedCases = [
    ['绾函鑴戝瓙鏈夋场', '\u8111\u5b50\u6709\u6ce1', 'attack'],
    ['閭ｉ┈鍜嬪竵', '\u90a3\u5988\u548b\u5e01', 'attack'],
    ['鐩存帴鏂氦涓嶅ソ鍚楋紵杩欎箞纾ㄥ徑锛屾湁浠€涔堝ソ鏉ュ線鐨勩€?', '\u8fd9\u4e48\u78e8\u53fd/\u76f4\u63a5\u65ad\u4ea4', 'attack'],
    ['娲昏娌℃湅鍙?', '\u6d3b\u8be5\u6ca1\u670b\u53cb', 'attack'],
    ['鏃堕棿涓婃渶涓ラ噸鐨勪氦閫氫簨鏁呭彂鐢熶簬2001.9.11 鐮村潖鍔涘法澶э紝閫犳垚2000浣欎汉浼や骸锛岀航绾﹀競褰撳ぉ鐦棯', '9/11\u4ea4\u901a\u4e8b\u6545\u53cd\u8bdd', 'attack'],
    ['浣犳案杩滃彨涓嶉啋瑁呯潯鐨勪汉锛屼絾鏄彲浠ョ潯浜嗚繖涓汉', '\u7761\u4e86\u8fd9\u4e2a\u4eba', 'attack'],
  ];

  for (const [text, term, family] of missedCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const round61Dictionary = {
    entries: [
      { term: '涓嶆槸', family: 'attack', meaning: 'direct negation' },
      { term: '鍔ｈ川', family: 'attack', meaning: 'low quality as attack' },
      { term: '娴侀噺', family: 'attack', meaning: 'traffic celebrity derogation' },
    ],
  };
  const suppressedCases = [
    '杩欒繖鑳戒竴鏍峰悧 杩欎笉鏄竴鏍风埍鍚?',
    '銆婁篃涓嶆槸瑕佹埓鐪奸暅銆?',
    '璇村疄璇濓紝杩欒窡闉墦姣斾笉浜嗭紝浣嗘斁鍦ㄧ幇鍦ㄥ洖褰掑お澶熺敤浜嗐€傛瘮鍚屾湡鏈夎川鎰燂紝鍓嶅崼锛岃€屼笖涓嶆槸鑸炴洸[绗戝摥]闄や簡缂栬垶澶按锛屾垜瀹屽叏鎯充笉鍒版煚妾按鎷夸粈涔堣緭',
    '濂藉姡璐ㄧ殑绱犳潗搴撳悗鏈熼煶鏁?',
    '浣犱笉鐢ㄥ伐浣滐紝娴侀噺灏卞彲浠ヨ禋閽变簡鍚楋紵',
    '绱犺川鏁欒偛涓嶈',
    '鏁戜汉涓€鍛借儨閫犱竷绾ф诞灞狅紝閭ｆ垜娌欎竴涓汉宀備笉鏄瘮鎺ㄥ€掍簡涓冨眰妤艰繕鍘夊',
  ];

  for (const text of suppressedCases) {
    const result = classifyCommentCoverage(round61Dictionary, text);
    if (text.includes('绗戝摥')) {
      assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), [['绗戝摥', 'cooperation']]);
    } else {
      assert.equal(result.mode, 'neutral');
      assert.deepEqual(result.hits, []);
    }
  }
});

test('classifyCommentCoverage handles round 61 escaped random audit cues', () => {
  const missedCases = [
    ['\u7eaf\u7eaf\u8111\u5b50\u6709\u6ce1', '\u8111\u5b50\u6709\u6ce1', 'attack'],
    ['\u90a3\u9a6c\u548b\u5e01', '\u90a3\u5988\u548b\u5e01', 'attack'],
    ['\u76f4\u63a5\u65ad\u4ea4\u4e0d\u597d\u5417\uff1f\u8fd9\u4e48\u78e8\u53fd\uff0c\u6709\u4ec0\u4e48\u597d\u6765\u5f80\u7684\u3002', '\u8fd9\u4e48\u78e8\u53fd/\u76f4\u63a5\u65ad\u4ea4', 'attack'],
    ['\u6d3b\u8be5\u6ca1\u670b\u53cb', '\u6d3b\u8be5\u6ca1\u670b\u53cb', 'attack'],
    ['\u65f6\u95f4\u4e0a\u6700\u4e25\u91cd\u7684\u4ea4\u901a\u4e8b\u6545\u53d1\u751f\u4e8e2001.9.11 \u7834\u574f\u529b\u5de8\u5927\uff0c\u9020\u62102000\u4f59\u4eba\u4f24\u4ea1\uff0c\u7ebd\u7ea6\u5e02\u5f53\u5929\u762b\u75ea', '9/11\u4ea4\u901a\u4e8b\u6545\u53cd\u8bdd', 'attack'],
    ['\u4f60\u6c38\u8fdc\u53eb\u4e0d\u9192\u88c5\u7761\u7684\u4eba\uff0c\u4f46\u662f\u53ef\u4ee5\u7761\u4e86\u8fd9\u4e2a\u4eba', '\u7761\u4e86\u8fd9\u4e2a\u4eba', 'attack'],
  ];

  for (const [text, term, family] of missedCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const round61Dictionary = {
    entries: [
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'direct negation' },
      { term: '\u52a3\u8d28', family: 'attack', meaning: 'low quality as attack' },
      { term: '\u6d41\u91cf', family: 'attack', meaning: 'traffic celebrity derogation' },
      { term: '\u7b11\u54ed', family: 'cooperation', meaning: 'laugh-cry tone marker' },
    ],
  };
  const suppressedCases = [
    ['\u8fd9\u8fd9\u80fd\u4e00\u6837\u5417 \u8fd9\u4e0d\u662f\u4e00\u6837\u7231\u5417', []],
    ['\u300a\u4e5f\u4e0d\u662f\u8981\u6234\u773c\u955c\u300b', []],
    ['\u8bf4\u5b9e\u8bdd\uff0c\u8fd9\u8ddf\u97ad\u6253\u6bd4\u4e0d\u4e86\uff0c\u4f46\u653e\u5728\u73b0\u5728\u56de\u5f52\u592a\u591f\u7528\u4e86\u3002\u6bd4\u540c\u671f\u6709\u8d28\u611f\uff0c\u524d\u536b\uff0c\u800c\u4e14\u4e0d\u662f\u821e\u66f2[\u7b11\u54ed]\u9664\u4e86\u7f16\u821e\u592a\u6c34\uff0c\u6211\u5b8c\u5168\u60f3\u4e0d\u5230\u67e0\u6aac\u6c34\u62ff\u4ec0\u4e48\u8f93', [['\u7b11\u54ed', 'cooperation']]],
    ['\u597d\u52a3\u8d28\u7684\u7d20\u6750\u5e93\u540e\u671f\u97f3\u6548', []],
    ['\u4f60\u4e0d\u7528\u5de5\u4f5c\uff0c\u6d41\u91cf\u5c31\u53ef\u4ee5\u8d5a\u94b1\u4e86\u5417\uff1f', []],
    ['\u7d20\u8d28\u6559\u80b2\u4e0d\u884c', []],
    ['\u6551\u4eba\u4e00\u547d\u80dc\u9020\u4e03\u7ea7\u6d6e\u5c60\uff0c\u90a3\u6211\u6c99\u4e00\u4e2a\u4eba\u5c82\u4e0d\u662f\u6bd4\u63a8\u5012\u4e86\u4e03\u5c42\u697c\u8fd8\u5389\u5bb3', []],
  ];

  for (const [text, expectedHits] of suppressedCases) {
    const result = classifyCommentCoverage(round61Dictionary, text);
    assert.deepEqual(result.hits.map((hit) => [hit.term, hit.family]), expectedHits);
    assert.equal(result.mode, expectedHits.length ? 'keyword' : 'neutral');
  }
});

test('classifyCommentCoverage handles round 62 random audit cues', () => {
  const neutralCases = [
    '\u6211\u6700\u8ba8\u538c\u4e8b\u540e\u9053\u6b49\uff01',
    '\u6211\u4e03\u79d1\u4e0d\u884c\uff0c\u4f53\u80b2\u5e9f\u7269\uff0c\u90a3\u6211\u662f\u4e5d\u6f0f\u9c7c\u7684\u4eb2\u621a\u2014\u2014\u516b\u50bb\u9c7c',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const upDescriptor = classifyCommentCoverage({
    entries: [{ term: 'up\u4e3b', family: 'cooperation', meaning: 'creator mention' }],
  }, '\u6124\u6012\u533aup\u4e3b\uff08\u25e3\u2014\u25e2\uff09');
  assert.equal(upDescriptor.mode, 'neutral');
  assert.deepEqual(upDescriptor.hits, []);

  const hateSpeech = classifyCommentCoverage(dictionary, '\u4ee5\u524d\u5728\u56fd\u5916\u5e72\u6d3b\u7528\u8fc7\u7279\u5236\u5957\u5b50\u6bdb\u59b9\u8bf4\u6bd4\u8001\u9ed1\u90a3\u8fd8\u5389\u5bb3\uff0c\u5b8c\u5168\u53ef\u4ee5\u4ee3\u66ff\u8001\u9ed1\u3002\u6709\u4e9b\u763e\u5927\u7684\u5973\u4eba\u627e\u7329\u7329\u5176\u5b9e\u5c31\u662f\u4e3a\u4e86\u627e\u523a\u6fc0\uff0c\u53ea\u8981\u5979\u4eec\u77e5\u9053\u6709\u4ee3\u66ff\u65b9\u6cd5\u5979\u4eec\u4e5f\u4e0d\u4f1a\u5192\u827e\u6ecb\u98ce\u9669\u548c\u81ed\u6c14\u627e\u7329\u7329\u3002');
  assert.equal(hateSpeech.mode, 'keyword');
  assert.ok(hateSpeech.hits.some((hit) => hit.term === '\u8001\u9ed1/\u7329\u7329\u79cd\u65cf\u5316\u8d2c\u635f' && hit.family === 'attack'));

  const fillerSuppression = classifyCommentCoverage({
    entries: [{ term: '\u5c31\u662f', family: 'cooperation', meaning: 'agreement marker' }],
  }, '\u6709\u4e9b\u4eba\u8fd9\u4e48\u505a\u5176\u5b9e\u5c31\u662f\u4e3a\u4e86\u627e\u523a\u6fc0');
  assert.equal(fillerSuppression.mode, 'neutral');
  assert.deepEqual(fillerSuppression.hits, []);
});

test('classifyCommentCoverage handles round 63 random audit cues', () => {
  const round63Dictionary = {
    entries: [
      { term: '\u81ea\u4fe1\u70b9', family: 'absolutes', meaning: 'strong confidence prompt' },
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'direct negation' },
      { term: '\u5e94\u8be5', family: 'cooperation', meaning: 'soft suggestion marker' },
    ],
  };

  const neutralCases = [
    '\u81ea\u4fe1\u70b9\uff0c\u89e3\u8bf4\u4e86\u4e5f\u662f',
    '\u6211\u5e76\u4e0d\u662f\u65e0\u8def\u53ef\u8d70\uff0c\u6211\u8fd8\u6709\u6b7b\u8def\u4e00\u6761',
    '0\u5206\u5c31\u4e0d\u7b54\u4e86\uff08doge\uff09',
    '\u5e94\u8be5\u65e9\u70b9\u7761',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round63Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const scolding = classifyCommentCoverage(round63Dictionary, '\u54c8\u54c8\u54c8\uff0c\u6211\u4eec\u8fd9\u4e0d\u4e5f\u5728\u9a82\u4f60\u5462\u5417\uff1f');
  assert.equal(scolding.mode, 'keyword');
  assert.ok(scolding.hits.some((hit) => hit.term === '\u6211\u4eec\u4e5f\u5728\u9a82\u4f60' && hit.family === 'attack'));
});

test('classifyCommentCoverage handles round 64 random audit cues', () => {
  const round64Dictionary = {
    entries: [
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: 'absolute denial' },
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'absolute generalization' },
      { term: '\u795e\u4e86', family: 'attack', meaning: 'sarcastic amazement' },
      { term: '\u6c99\u96d5', family: 'attack', meaning: 'derogatory silly/idiot label' },
      { term: '\u7262\u5927', family: 'attack', meaning: 'mocking nickname' },
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'direct negation' },
    ],
  };

  const neutralCases = [
    '\u4e2a\u4eba\u5bf9\u8fd9\u6bb5\u6ca1\u6709\u5370\u8c61',
    '\u8bcd\u548c\u66f2\u90fd\u662f\u8868\u8fbe\u7684\u8f7d\u4f53',
    '\u5b69\u5b50\u88ab\u7535\u51fb\u4e86\uff0c\u771f\u7684\u592a\u6709\u804c\u4e1a\u7cbe\u795e\u4e86[\u5927\u54ed]',
    '\u8fd9\u4e09\u90e8\u4f5c\u54c1\u5206\u522b\u4ee3\u8868\u4e86\u60ac\u7591\u5411\u3001\u70ed\u8840\u5411\u3001\u6c99\u96d5\u5411',
    '\u76f4\u5347\u673a\u4e0a\u5de6\u5df4\u6768\uff0c\u4ea1\u6768\u6355\u7262\u5927\u51c9\u51c9',
    '\u4e0d\u662f\u54e5\u4eec\uff0c\u4ec0\u4e48\u5730\u94c1\u5546\u573a\uff0c\u519c\u6751\u6709\u90a3\u73a9\u610f\u5417',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round64Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const absolute = classifyCommentCoverage(round64Dictionary, '\u5ba0\u7269\u662f\u7269\u54c1\uff0c\u65e0\u4efb\u4f55\u6743\u529b\uff0c\u8fd8\u5165\u5211');
  assert.equal(absolute.mode, 'keyword');
  assert.ok(absolute.hits.some((hit) => hit.term === '\u65e0\u4efb\u4f55' && hit.family === 'absolutes'));
});

test('classifyCommentCoverage handles round 65 random audit cues', () => {
  const round65Dictionary = {
    entries: [
      { term: 'p\u7684', family: 'attack', meaning: 'image authenticity challenge' },
      { term: '\u5c31\u662f', family: 'cooperation', meaning: 'agreement marker' },
      { term: '\u6ed1\u7a3d', family: 'attack', meaning: 'teasing emote text' },
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: 'absolute denial' },
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'direct negation' },
    ],
  };

  const neutralCases = [
    '\u5b83\u4e0d\u662f\u4e00\u4e2aAPP\uff0c\u800c\u662f\u4e00\u4e2a\u4e13\u95e8\u76d7\u89c6\u9891\u7684\u673a\u5668\u4eba\u5e10\u53f7\u3002\u4efb\u4f55\u81ea\u5a92\u4f53up\u7684\u89c6\u9891\u90fd\u4f1a\u88ab\u5b83\u505a\u6210\u4e00\u4e2a\u526f\u672c[doge]',
    '\u6211\u5c31\u662f\u53d1\u5b8c\u5f39\u5e55\uff0c\u7136\u540e\u518d\u9000\u51fa\u89c6\u9891\uff0c\u7136\u540e\u91cd\u65b0\u518d\u70b9\u8fdb\u53bb\u89c6\u9891\u770b\u90a3\u4e2a\u4e0a\u9762\u7684\u6211\u7684\u8bc4\u8bba',
    '\u518d\u8fc7\u51e0\u5e74\u5e74\u7eaa\u5927\u4e86\u5c31\u4f1a\u548c\u5e72\u7239\u4e00\u6837\u591a\u4e86\u4e00\u4e2a\u8dd1\u8dd1[\u6ed1\u7a3d]',
    '\u6ca1\u6709\u77ed\u89c6\u9891\u7684\u65f6\u5019',
    '\u7ebf\u4e0a\u7ebf\u4e0b\u4e0d\u662f\u4e00\u7c7b\u4eba',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round65Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 66 random audit cues', () => {
  const round66Dictionary = {
    entries: [
      { term: '\u4e3a\u4ec0\u4e48', family: 'evidence', meaning: 'question marker' },
      { term: '\u628a\u628a', family: 'cooperation', meaning: 'every round carry' },
      { term: '\u6b7b\u4e86', family: 'attack', meaning: 'death-coded attack' },
      { term: '\u89c9\u5f97', family: 'cooperation', meaning: 'softening opinion marker' },
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'sweeping all statement' },
    ],
  };

  const neutralCases = [
    '\u65e2\u7136\u60f3\u9738\u699c\u4e3a\u4ec0\u4e48\u4e0d\u628a\u628a\u4e00\u5343\u4e07',
    '\u5435\u6b7b\u4e86\u771f\u7684',
    '\u6211\u600e\u4e48\u89c9\u5f97\u7cbe\u795e\u5f00\u59cb\u51fa\u95ee\u9898\u4e86\uff1f',
    '\u7acb\u4f53\u51e0\u4f55\u6211\u5f53\u5e74\u4ece\u5b66\u4e86\u5c31\u4ece\u6765\u6ca1\u9519\u8fc7\uff0c\u5c31\u4e00\u76f4\u90fd\u662f\u5efa\u7cfb\u7136\u540e\u7b97\u51e0\u4e2a\u6570\u5c31\u5b8c\u4e8b\u4e86',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round66Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const titleRepeat = classifyCommentCoverage({ entries: [] }, '\u8d85\u7ea7\u559c\u6b22\u4f60 \u8fde\u7ffb\u8138\u4e5f\u6ca1\u5e95\u6c14 5');
  assert.equal(titleRepeat.mode, 'neutral');
  assert.deepEqual(titleRepeat.hits, []);

  const keyZheng = classifyCommentCoverage({ entries: [] }, '\u952e\u6b63\u4e5f\u4f1a\u88ab\u6807\u8bb0\u5427');
  assert.equal(keyZheng.mode, 'keyword');
  assert.ok(keyZheng.hits.some((hit) => hit.term === '\u952e\u6b63' && hit.family === 'evasion'));
});

test('classifyCommentCoverage handles round 67 random audit cues', () => {
  const round67Dictionary = {
    entries: [
      { term: '\u6211\u53bb', family: 'attack', meaning: 'interjection' },
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: 'negation' },
      { term: '\u732a\u9f3b', family: 'attack', meaning: 'insult' },
      { term: '\u786e\u5b9e', family: 'cooperation', meaning: 'agreement' },
      { term: '\u4e3a\u4ec0\u4e48', family: 'evidence', meaning: 'question' },
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'all' },
      { term: '\u56fe\u7a77\u5315\u89c1', family: 'attack', meaning: 'revealed intent' },
      { term: '\u7701\u6d41', family: 'cooperation', meaning: 'summary' },
      { term: '\u89c9\u5f97', family: 'cooperation', meaning: 'opinion' },
      { term: '\u80af\u5b9a', family: 'absolutes', meaning: 'certainty' },
      { term: '\u53ef\u7231', family: 'cooperation', meaning: 'cute' },
      { term: '\u5168\u90fd', family: 'absolutes', meaning: 'all' },
      { term: '\u8282\u594f', family: 'attack', meaning: 'rhythm/brigading' },
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'negation' },
    ],
  };

  const neutralCases = [
    '\u6211\u53bb\u8bd5\u8bd5\uff0c\u521a\u597d\u6211\u8fd9\u5b66\u671f\u6709\u4e00\u79d1\u4e0a\u4e00\u5c4a\u6302\u4e86\u4e8c\u5341\u4e2a\u4eba\uff0c\u6211\u770b\u770b\u6709\u6ca1\u6709\u7528',
    '\u732a\u9f3b\u8fd9\u4e2a\u4f53\u8272\u786e\u5b9e\u5f97\u8d35',
    '\u4f60\u4e3a\u4ec0\u4e48\u4e3a\u96be\u81ea\u5df1\uff1f',
    '\u7ec8\u4e8e\u4e5f\u80fd\u8ffd\u522b\u4eba\u4e86\uff0c\u5927G\u5411\u6765\u90fd\u662f\u88ab\u522b\u4eba\u8ffd',
    '\u6709\u6ca1\u6709\u4eba\u770b\u770b\u671f\u8d27\u5e02\u573a\u6709\u6ca1\u6709\u65b0\u6237\u5934\u5f00\u5927\u5355\u5565\u7684',
    '\u7701\u6d41\uff1a\u56fe\u7a77\u5315\u89c1',
    '\u6709\u94b1\u4e86 \u7136\u540e\u5c31\u89c9\u5f97\u81ea\u5df1\u662f\u5927\u5973\u4e3b',
    '\u90a3\u80af\u5b9a\u4fee\u4e0d\u597d\u4e86\u5427',
    '\u8bf6p4\u8fd9\u4e2a\u662f\u6709\u5c3e\u5df4\u7684\u5417\u597d\u53ef\u7231',
    '\u5168\u90fd\u627f\u8ba4\u4e86\uff0c\u662f\u771f\u7684\u8ba4\u9519\u4e86\uff0c\u5feb\u56de\u6765\u5427',
    '\u60f3\u8981\u5168\u5bb6\u8986\u6ca1\u7684\u8282\u594f\u5417\uff1f',
    '\u8bf7\u6ce8\u610f\u53f8\u673a\u5e76\u4e0d\u662f\u5218\u6c0f\u96c6\u4f53\u5458\u5de5\uff0c\u6240\u4ee5\u8bf7\u524d\u9762\u7684\u4eba\u5728\u770b\u51e0\u6b21\u7535\u5f71',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round67Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 68 random audit cues', () => {
  const round68Dictionary = {
    entries: [
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'negation' },
      { term: '\u5c31\u662f', family: 'cooperation', meaning: 'emphasis' },
      { term: '\u53ef\u80fd', family: 'cooperation', meaning: 'hedge' },
      { term: '\u53ef\u80fd\u662f', family: 'cooperation', meaning: 'hedge' },
      { term: '\u54c8\u54c8\u54c8', family: 'attack', meaning: 'laughter' },
      { term: '\u54c8\u54c8', family: 'cooperation', meaning: 'laughter' },
      { term: '\u4e00\u5f8b', family: 'absolutes', meaning: 'all' },
      { term: '\u80af\u5b9a', family: 'absolutes', meaning: 'certainty' },
      { term: '\u7ef7\u4f4f', family: 'cooperation', meaning: 'hold laughter' },
      { term: '\u6ca1\u7ef7\u4f4f', family: 'cooperation', meaning: 'could not hold laughter' },
      { term: '\u90fd\u662f', family: 'absolutes', meaning: 'all are' },
      { term: '\u771f\u662f', family: 'cooperation', meaning: 'really is' },
      { term: '\u53ef\u7231', family: 'cooperation', meaning: 'cute' },
    ],
  };

  const neutralCases = [
    '\u54e6\uff01\u539f\u6765\u4e0d\u662f\u8001\u4e61\uff01',
    '\u5176\u5b9e\u5c31\u662fAI\u7248\u6743\u4fdd\u62a4',
    '\u53ef\u80fd\u662f\u56e0\u4e3a\u90a3\u4e2a\u4eba\u2026\u5fa1\u517d\u80fd\u529b\u6bd4\u8f83\u5f3a',
    '\u54c8\u54c8\u54c8\u54c8\u54c8\u5408\u7406',
    '\u5c11\u5e74\u7684\u81ea\u7531\u53bb\u4e86\uff0c\u6211\u4eec\u4e0d\u5728\u62e5\u6709\u7b11\u5bb9\uff0c\u770b\u7740\u5343\u7bc7\u4e00\u5f8b\u7684\u751f\u6d3b\uff0c\u518d\u6b21\u56de\u60f3\u5c11\u5e74\u7684\u65f6\u4ee3',
    '\u65e2\u7136\u5217\u88c5\u4e86\uff0c\u5217\u88c5\u524d\u80af\u5b9a\u505a\u8db3\u4e86\u529f\u8bfe\u4e86\uff0c\u5916\u884c\u5c31\u522b\u778e\u64cd\u5fc3\u4e86',
    '\u5b8c\u4e86\u6ca1\u7ef7\u4f4f',
    '\u53ef\u7231\u4e0d^_^ 1',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round68Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const attackCases = [
    '\u600e\u4e48\u4e0d\u8bad\u72d7\u6574\u4e0a\u4e8c\u4eba\u8f6c\u4e86',
    '\u770b\u4eba\u771f\u51c6\u2193\uff1f',
    '\u7f3a\u5fb7\u73a9\u610f\uff0c\u6253\u6b7b\u5077\u72d7\u8d3c',
    '\u4efb\u4f55\u4e0d\u4ee5\u7ed3\u5a5a\u4e3a\u76ee\u7684\u7684\u8c08\u604b\u7231\u90fd\u662f\u800d**\uff01',
    '\u670d\u4e86\uff0c\u771f\u662f\u5bb3\u4eba\u4e0d\u6d45',
  ];

  for (const text of attackCases) {
    const result = classifyCommentCoverage(round68Dictionary, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.family === 'attack'));
  }

  const joinStudy = classifyCommentCoverage(round68Dictionary, '\u6211\u6211\u6211\u4e5f\u5b66');
  assert.equal(joinStudy.mode, 'keyword');
  assert.ok(joinStudy.hits.some((hit) => hit.family === 'cooperation'));
});

test('classifyCommentCoverage handles round 69 random audit cues', () => {
  const round69Dictionary = {
    entries: [
      { term: '\u7ef7\u4f4f', family: 'cooperation', meaning: 'hold laughter' },
      { term: '\u6ca1\u7ef7\u4f4f', family: 'cooperation', meaning: 'could not hold laughter' },
      { term: '\u5e94\u8be5\u662f', family: 'cooperation', meaning: 'speculation' },
      { term: '\u6ca1\u6709', family: 'absolutes', meaning: 'negation' },
      { term: '\u80af\u5b9a', family: 'absolutes', meaning: 'certainty' },
      { term: '\u4e0d\u662f', family: 'attack', meaning: 'negation' },
      { term: '\u5c31\u662f', family: 'cooperation', meaning: 'copula' },
      { term: '\u5c0f\u59d0\u59d0', family: 'cooperation', meaning: 'young woman address' },
    ],
  };

  const neutralCases = [
    '\u4e0d\u884c\u6ca1\u7ef7\u4f4f',
    '\u6bd5\u7adf\u8fd9\u7528\u5fc3\u7a0b\u5ea6\u5df2\u7ecf\u4e0d\u4e00\u6837\uff0c\u4f46\u8bf4\u7684\u5e94\u8be5\u662f\u540c\u7b49\u6c34\u5e73\u7684\u60c5\u51b5\u4e0b',
    '\u8fd9\u4e5f\u6ca1\u670980\u4e2a\u53f0\u5b50\u554a',
    '\u522b\u8bf4\u7275\u5f3a\uff0c\u5bfc\u6f14\u80af\u5b9a\u6bd4\u8fd9\u60f3\u5f97\u591a',
    '\u4e09\u5341\u800c\u7acb\uff08\u867d\u7136\u597d\u50cf\u4e0d\u662f\u6210\u8bed\uff1f',
    '\u4ffa\u5c31\u662f\u4e2a\u81ed\u5546\u4eba\uff0c\u5999\u754c\u5c0f\u59d0\u59d0\u5feb\u7528\u5c0f\u62f3\u62f3\u6253\u4ffa\u80f8\u53e3\uff01',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage(round69Dictionary, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }

  const blame = classifyCommentCoverage(round69Dictionary, '\u5c31\u81ea\u5df1\u6c92\u5e95\u7dda \u554f\u984c\u6838\u5fc3\u5728\u65bc\u81ea\u5df1\u8eab\u4e0a');
  assert.equal(blame.mode, 'keyword');
  assert.ok(blame.hits.some((hit) => hit.family === 'attack'));

  const noviceHelp = classifyCommentCoverage(round69Dictionary, '\u7eaf\u5c0f\u767d\uff0c\u697c\u4e3b\u627e\u5230\u6559\u7a0b\u4e86\u5417');
  assert.equal(noviceHelp.mode, 'keyword');
  assert.ok(noviceHelp.hits.some((hit) => hit.family === 'cooperation'));
});

test('classifyCommentCoverage handles round 70 random audit cues', () => {
  const round70Dictionary = {
    entries: [
      { term: '\u907f\u96f7', family: 'cooperation', meaning: 'warning/share pitfall' },
    ],
  };

  const warning = classifyCommentCoverage(round70Dictionary, '\u907f\u96f7\u4e00\u4e0b\u54c8\uff0c\u8fd9\u4e0d\u662f\u723d\u6587\uff0c\u8fd9\u662f\u751c\u6587');
  assert.equal(warning.mode, 'keyword');
  assert.ok(warning.hits.some((hit) => hit.term === '\u907f\u96f7\u4e00\u4e0b' && hit.family === 'correction'));

  const laundering = classifyCommentCoverage(round70Dictionary, '\u73b0\u5728\u90fd\u4e0d\u6d17\u4e86\uff0c\u76f4\u63a5\u7528\u6bd4\u7279\u5e01');
  assert.equal(laundering.mode, 'keyword');
  assert.ok(laundering.hits.some((hit) => hit.term === '\u4e0d\u6d17\u4e86\u76f4\u63a5\u7528\u6bd4\u7279\u5e01' && hit.family === 'evasion'));

  const titleRepeat = classifyCommentCoverage(round70Dictionary, '\u8d85\u7ea7\u559c\u6b22\u4f60 \u8fde\u7ffb\u8138\u4e5f\u6ca1\u5e95\u6c14 5');
  assert.equal(titleRepeat.mode, 'neutral');
  assert.deepEqual(titleRepeat.hits, []);
});

test('classifyCommentCoverage handles round 71 random audit cues', () => {
  const neutralPraise = classifyCommentCoverage({ entries: [] }, '\u6551\u547d\uff01\u6ce2\u6ce2\u56de\u6765\u4e86\u545c\u545c\u545c\uff0c\u6211\u7231\u6ce2\u6ce2');
  assert.equal(neutralPraise.mode, 'neutral');
  assert.deepEqual(neutralPraise.hits, []);

  const playfulDogePun = classifyCommentCoverage({ entries: [] }, '\u56de\u590d @Ancient-Temple :\u8001\u94c1\u53ea\u4f1a\u751f\u9508[doge]');
  assert.equal(playfulDogePun.mode, 'neutral');
  assert.deepEqual(playfulDogePun.hits, []);

  const ancestorTaunt = classifyCommentCoverage({ entries: [] }, '\u4f60\u7956\u5b97\u5230\u6b64\u4e00\u6e38 1');
  assert.equal(ancestorTaunt.mode, 'keyword');
  assert.ok(ancestorTaunt.hits.some((hit) => hit.term === '\u4f60\u7956\u5b97' && hit.family === 'attack'));
});

test('classifyCommentCoverage handles round 72 random audit cues', () => {
  const attackCases = [
    ['\u6709\u6ca1\u6709\u53ef\u80fd\uff0c\u56e0\u4e3a\u786e\u5b9e\u96be\u542c\u624d\u63d0\u610f\u89c1', '\u6709\u6ca1\u6709\u53ef\u80fd\u96be\u542c\u624d\u63d0\u610f\u89c1'],
    ['\u542c\u4e0a\u53bb\u662f\u6c49\u6c11\u5f85\u9047', '\u6c49\u6c11\u5f85\u9047'],
    ['\u522b\u52b3\u522b\u8fc8\u4e86\uff0c\u6ca1\u6709\u5c31\u522b\u8bf4', '\u522b\u52b3\u522b\u8fc8\u6ca1\u6709\u5c31\u522b\u8bf4'],
    ['\u4e0d\u8981\u8ddf\u8fd9\u4e9b\u8001\u5a18\u4eec\u8bf4\u4e86\uff0c\u76f4\u63a5\u8d77\u8bc9', '\u8001\u5a18\u4eec\u76f4\u63a5\u8d77\u8bc9'],
    ['\u8c01\u5148\u6b7b\u8c01\u5c31\u5148\u6740', '\u8c01\u5148\u6b7b\u8c01\u5c31\u5148\u6740'],
    ['\u4e0d\u662f\u72fc\u706d\u5417', '\u72fc\u706d'],
    ['\u5509\uff0c\u8fb9\u5883\uff0c\u7b7e\u8bc1\u90fd\u88ab\u5370\u5ea6\u62ff\u634f\u6b7b\u6b7b\u7684', '\u62ff\u634f\u6b7b\u6b7b\u7684'],
  ];

  for (const [text, term] of attackCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === 'attack'));
  }

  const systemMessageMeme = classifyCommentCoverage({ entries: [] }, '\u60a8\u7684\u597d\u53cb[\u6cd5\u5170\u897f\u5171\u548c\u56fd]\u5df2\u9000\u51fa\u76f4\u64ad\u95f4');
  assert.equal(systemMessageMeme.mode, 'keyword');
  assert.ok(systemMessageMeme.hits.some((hit) => hit.term === '\u5df2\u9000\u51fa\u76f4\u64ad\u95f4\u68d7' && hit.family === 'evasion'));
});

test('classifyCommentCoverage handles round 74 random audit cues', () => {
  const attackCases = [
    ['\u4eba\u624d\u5440', '\u4eba\u624d\u5440'],
    ['\u6211\u662f\u4f60\u7238\u7238\u3002', '\u6211\u662f\u4f60\u7238\u7238'],
    ['\u90fd\u8d31', '\u90fd\u8d31'],
    ['\u7834\u4ea7\u540e\u7531\u5962\u5165\u7b80\u7684\u5c0f\u660e\u611f\u53f9\u5230\uff1a\u201c\u88ab\u5f3a\u4fed\u4e86\u201d', '\u88ab\u5f3a\u4fed\u4e86'],
  ];

  for (const [text, term] of attackCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === 'attack'));
  }

  const neutralCases = [
    '\u4eba\u624d\u6d4e\u6d4e\uff0c\u8fd9\u4e2a\u56e2\u961f\u592a\u5f3a\u4e86',
    '\u4ed6\u786e\u5b9e\u662f\u4e2a\u79d1\u7814\u4eba\u624d',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 75 random audit cues', () => {
  const attackCases = [
    ['\u90a3\u5c31\u5148\u6740\u4e86\u4ed6\uff0c\u5b81\u89c1\u6cd5\u5b98\u4e0d\u89c1\u6cd5\u533b', '\u5b81\u89c1\u6cd5\u5b98\u4e0d\u89c1\u6cd5\u533b'],
    ['\u522b\u627e\u5c01\u9762\u4e86\uff0c\u8bb0\u5f97\u70b9\u8e29', '\u8bb0\u5f97\u70b9\u8e29'],
    ['\u89c9\u9192\u7fa4\uff0c\u62b5\u5236\u77eb\u6b63\u4f9b\u517b\u8005\u503e\u5411\u805a\u62e2\u89c9\u9192\u7537\u6027\uff0c\u6563\u5175\u6e38\u52c7', '\u89c9\u9192\u7fa4/\u77eb\u6b63\u4f9b\u517b\u8005'],
    ['\u574f\u8d77\u6765\u4e86\u5144\u5f1f\u4eec\uff0c\u539f\u6765\u771f\u6709\u8363\u8a89\u5973\u4eba', '\u8363\u8a89\u5973\u4eba'],
  ];

  for (const [text, term] of attackCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === 'attack'));
  }

  const correction = classifyCommentCoverage({ entries: [] }, '\u5728\u795e\u8bdd\u4f20\u8bf4\u4e2d\u5929\u4f7f\u5f80\u5f80\u662f\u767d\u8272\u7684\uff0c\u9b54\u9b3c\u5f80\u5f80\u662f\u9ed1\u8272\u7684 \u8fd9\u662f\u4e00\u79cd\u79cd\u65cf\u6b67\u89c6\uff01\u8b66\u60d5\uff01');
  assert.equal(correction.mode, 'keyword');
  assert.ok(correction.hits.some((hit) => hit.term === '\u79cd\u65cf\u6b67\u89c6\u8b66\u60d5' && hit.family === 'correction'));

  const neutralDiscussion = classifyCommentCoverage({ entries: [] }, '\u4eca\u5929\u7684\u8bfe\u7a0b\u8bb2\u79cd\u65cf\u6b67\u89c6\u7684\u5386\u53f2\u80cc\u666f');
  assert.equal(neutralDiscussion.mode, 'neutral');
  assert.deepEqual(neutralDiscussion.hits, []);
});

test('classifyCommentCoverage handles round 76 random audit cues', () => {
  const cases = [
    ['\u5211\u8baf\u903c\u4f9b\uff0c\u56fd\u5185\u4e5f\u6709\uff0c\u53ea\u662f\u76d1\u63a7\u574f\u4e86\uff0c\u4f60\u770b\u4e0d\u5230', '\u5211\u8baf\u903c\u4f9b\u76d1\u63a7\u574f\u4e86', 'attack'],
    ['\u4f60\u4eec\u5982\u679c\u8bf4\u8fd9\u662f\u526a\u8f91\uff0c\u90a3\u4f60\u4eec\u5148\u8bf4\u600e\u4e48\u526a\u8f91\u7684\uff0c\u628a\u8fc7\u7a0b\u544a\u8bc9\u6211\u4eec', '\u600e\u4e48\u526a\u8f91/\u628a\u8fc7\u7a0b\u544a\u8bc9', 'evidence'],
    ['\u9006\u5929\u5c01\u9762', '\u9006\u5929', 'absolutes'],
    ['\u4e0d\u670d\u7684\u4f60\u4eec\u6765\u6311\u6218\u5440', '\u4e0d\u670d\u6765\u6311\u6218', 'attack'],
    ['\u8fd9\u4e0d\u72af\u6cd5\u5417', '\u8fd9\u4e0d\u72af\u6cd5\u5417', 'evidence'],
    ['\u5b69\u5b50\uff0c\u4f60\u6570\u5b66\u57fa\u672c\u53ef\u4ee5\u653e\u5f03\u4e86', '\u6570\u5b66\u57fa\u672c\u53ef\u4ee5\u653e\u5f03\u4e86', 'attack'],
    ['\u521a\u5f00\u59cb\u5b66AE\u6709\u6728\u6709\u4e00\u8d77\u5b66\u7684\u5c0f\u4f19\u4f34', '\u6709\u6ca1\u6709\u4e00\u8d77\u5b66\u7684\u5c0f\u4f19\u4f34', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralIdiom = classifyCommentCoverage({ entries: [] }, '\u4ed6\u60f3\u9760\u52aa\u529b\u9006\u5929\u6539\u547d');
  assert.equal(neutralIdiom.mode, 'neutral');
  assert.deepEqual(neutralIdiom.hits, []);
});

test('classifyCommentCoverage handles round 77 random audit cues', () => {
  const cases = [
    ['\u6211\u89c1\u7334\u7fa4\u591a\u59a9\u5a9a\uff0c\u6599\u7334\u7fa4\u89c1\u6211\u5e94\u5982\u662f', '\u6211\u89c1\u7334\u7fa4\u591a\u59a9\u5a9a', 'attack'],
    ['\u653e\u5c41\uff01\u90a3\u4e3a\u5565\u51fa\u95e8\u4e0d\u6813\u7ef3\u4e71\u5f80\u4eba\u5bb6\u8f66\u80ce\u6492\u5c3f\uff1f', '\u653e\u5c41', 'attack'],
    ['\u4e0a\u53bb\u80fd\u4fdd\u62a4\u4ec0\u4e48\uff1f\uff1f\u4e0e\u5e7f\u544a\u724c\u5171\u5b58\u4ea1\uff1f', '\u4e0e\u5e7f\u544a\u724c\u5171\u5b58\u4ea1', 'attack'],
    ['\u8981 \u6765 \u529b', '\u8981\u6765\u529b', 'cooperation'],
    ['40\u79d2\u4e86\uff0c\u53ef\u4ee5\u7b11\u4e86\u3002', '\u51e0\u79d2\u4e86\u53ef\u4ee5\u7b11\u4e86', 'cooperation'],
    ['\u6709\u4e9b\u8822\u4eba\u5c31\u662f\u8981\u628a\u4ed6\u542c\u9192\uff0c\u73bb\u7483\u5fc3\u8fde\u9ea6\u5e72\u4ec0\u4e48\u5462', '\u8822\u4eba/\u73bb\u7483\u5fc3', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u73bb\u7483\u5fc3\u7684\u5236\u4f5c\u5de5\u827a\u5f88\u590d\u6742',
    '\u8001\u5e08\u8bf440\u79d2\u4e86\uff0c\u53ef\u4ee5\u5f00\u59cb\u7b54\u9898\u4e86',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 78 random audit cues', () => {
  const cases = [
    ['\u5395\u6240\u91cc\u4e24\u4e2a\u5751\u653e\u4e00\u8d77\uff0c\u5e95\u4e0b\u56de\u590d\u8bf4\u9759\u89c2\u5176\u4fbf\uff0c\u613f\u95fb\u5176\u7fd4\u90a3\u5f20\u56fe', '\u9759\u89c2\u5176\u4fbf/\u613f\u95fb\u5176\u7fd4', 'cooperation'],
    ['\u5951\u7ea6\u5df2\u6210\uff0c\u8d50\u5c14\u5e94\u8bb8\u4e4b\u7269\uff08\u5df2\u6295\u5e01\uff09', '\u5951\u7ea6\u5df2\u6210/\u5df2\u6295\u5e01', 'cooperation'],
    ['\u8fd9\u80fd\u89e3\u91ca\u5f97\u901a\u534e\u7f57\u5e9a\u548c\u9ad8\u65af\u4e00\u8d77\u590d\u6d3b\u7ed9\u4f60\u9881\u5956', '\u590d\u6d3b\u7ed9\u4f60\u9881\u5956', 'attack'],
    ['\u90a3\u4e9b\u76d7\u53f7\u7684\u771f\u7684\u4e0d\u914d\u662f\u7ad9\u7528\u6237\uff0c\u771f\u662f\u592a\u53ef\u6015\u4e86', '\u76d7\u53f7\u7684\u4e0d\u914d', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u6211\u521a\u521a\u7ed9\u8fd9\u4e2a\u89c6\u9891\u6295\u5e01\u4e86',
    '\u533b\u5b66\u4e0a\u7684\u590d\u6d3b\u6982\u5ff5\u4e0d\u5b58\u5728',
    '\u8bf7\u68c0\u67e5\u4f60\u7684\u8d26\u53f7\u5b89\u5168\uff0c\u907f\u514d\u88ab\u76d7\u53f7',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 79 random audit cues', () => {
  const cases = [
    ['\u5267\u60c5\u6865\u6bb5\u6709\u70b9\u5f31\u8d28\u5c5e\u4e8e\u662f', '\u5f31\u8d28\u5c5e\u4e8e\u662f', 'attack'],
    ['\u732b\u95f4\u5931\u683c', '\u732b\u95f4\u5931\u683c/X\u95f4\u5931\u683c', 'cooperation'],
    ['\u770b\u56fe\u7ef7\u4f4f\u4e86\uff0c\u4e00\u770b\u5230\u5927\u529b\u738b\u6ca1\u7ef7\u4f4f', '\u7ef7\u4f4f/\u6ca1\u7ef7\u4f4f', 'cooperation'],
    ['\u6709\u65f6\u5019\u770b\u8ff7\u60d1\u89c6\u9891\u8ddf\u8d64\u77f3\u6ca1\u4ec0\u4e48\u4e24\u6837', '\u8d64\u77f3/\u5403\u5c4e\u8c10\u97f3', 'attack'],
    ['\u91d1\u5c5e\u53e3\u7ea2\u4e0d\u662f\u4e00\u5768\uff1f', '\u4e00\u5768', 'attack'],
    ['\u54c8\u54c8\u54c8\u54c8\u54c8\u7ea2\u7ea2\u706b\u706b\u604d\u604d\u60da\u60da', '\u7ea2\u7ea2\u706b\u706b\u604d\u604d\u60da\u60da', 'cooperation'],
    ['\u4e0d\u4f1a\u521b\u4f5c\uff0c\u5c31\u662f\u767d\u642d', '\u5c31\u662f\u767d\u642d', 'absolutes'],
    ['\u771f\u662f\u5bf9\u725b\u5f39\u7434', '\u5bf9\u725b\u5f39\u7434', 'attack'],
    ['\u770b\u5b8c\u5927\u8111\u8936\u76b1\u88ab\u629a\u5e73\u4e86', '\u5927\u8111\u8936\u76b1\u88ab\u629a\u5e73', 'attack'],
    ['\u98de\u5929\u5927\u7107', '\u7107/\u5927\u7107', 'attack'],
    ['\u8fd8\u6709\u4eba\u7c7b\u5417\uff1f', '\u8fd8\u6709\u4eba\u7c7b\u5417', 'attack'],
    ['\u8fd9\u4e2a\u6df7\u5b50\u53c8\u51fa\u73b0\u4e86', '\u6df7\u5b50', 'attack'],
    ['\u771f\u4eba\u56e2 \u63a5\u63a5\u63a5', '\u63a5\u63a5\u63a5', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const emoteResult = classifyCommentCoverage({ entries: [] }, '(\u22673\u2266)');
  assert.equal(emoteResult.mode, 'keyword');
  assert.ok(emoteResult.hits.some((hit) => hit.term === 'kaomoji playful tone marker' && hit.family === 'cooperation'));

  const neutralCases = [
    '\u8fd9\u662f\u4e00\u5757\u6ce5\u571f',
    '\u6211\u4eca\u5929\u5b66\u4e86\u9ea6\u5757\u8d64\u77f3\u7535\u8def',
    '\u5c0f\u767d\u5154\u767d\u53c8\u767d',
    '\u533b\u5b66\u8bfe\u4e0a\u8bb2\u5230\u5927\u8111\u8936\u76b1\u548c\u795e\u7ecf\u53d1\u80b2',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 80 random audit cues', () => {
  const cases = [
    ['\u5e0c\u671b\u6361\u72d7\u7684\u54ea\u5929\u5b69\u5b50\u88ab\u4eba\u6361\u8d70', '\u5e0c\u671b\u54ea\u5929\u88ab\u4eba\u6361\u8d70', 'attack'],
    ['\u524d\u9762\u7684\u626f\u4ec0\u4e48\u86cb\u5462\uff0c\u624d\u8fd9\u4e48\u51e0\u5929\u8f6e\u8239\u80fd\u9508\u6210\u8fd9\u6837\uff1f', '\u626f\u4ec0\u4e48\u86cb', 'attack'],
    ['\u628a\u4ed6\u4eec\u6253\u6b7b\u5c31\u4e0d\u4f1a\u6709\u4eba\u6253\u67b6\u4e86', '\u6253\u6b7b\u5c31\u4e0d\u4f1a\u6709', 'attack'],
    ['\u8fd9\u4e2a\u4e2d\u56fd\u4eba\u6211\u770b\u7740\u5f88\u4e0d\u559c\u6b22\uff0c\u61c2\u5f97\u4e0d\u592a\u591a', '\u770b\u7740\u5f88\u4e0d\u559c\u6b22', 'attack'],
    ['\u300a\u4e0a\u6765\u4e86\u300b', '\u4e66\u540d\u53f7\u53cd\u8bed\u5f15\u7528', 'attack'],
    ['\u8fd9 \u5c31 \u662f \u4f60 \u5206 \u9996 \u7684 \u501f \u53e3', '\u8fd9 \u5c31 \u662f \u4f60 \u7684 \u501f \u53e3', 'attack'],
    ['\u5bf9\u4e0d\u8d77\uff0c\u6ca1\u7ef7\u4f4f\u3002\u3002', '\u6ca1\u7ef7\u4f4f\u9053\u6b49\u5f0f\u7b11\u573a', 'cooperation'],
    ['\u9501\u4e86\u4e2a\u5bc2\u5bde', '\u4e86\u4e2a\u5bc2\u5bde', 'attack'],
    ['\u6ca1\u94b1\u548c\u6027\u522b\u6709\u6bdb\u5173\u7cfb', '\u6709\u6bdb\u5173\u7cfb', 'attack'],
    ['\u621112\u5e74\u7684\u4e0d\u80cc\u8fd9\u4e2a\u9505', '\u4e0d\u80cc\u8fd9\u4e2a\u9505', 'evasion'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u300a\u7ea2\u697c\u68a6\u300b\u662f\u4e2d\u56fd\u53e4\u5178\u5c0f\u8bf4',
    '\u8fd9 \u5c31 \u662f \u4f60 \u7684 \u540d \u5b57',
    '\u5b8c\u4e86\u6ca1\u7ef7\u4f4f',
    '\u6211\u4e0d\u559c\u6b22\u8fd9\u9053\u83dc\u7684\u989c\u8272',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 81 random audit cues', () => {
  const cases = [
    ['\u9a82\u4ed6\u4eec\u90fd\u662f\u8f7b\u7684', '\u9a82\u90fd\u662f\u8f7b\u7684', 'attack'],
    ['\u7956\u5b97\u6211\u6d3b\u7740\u90fd\u6ca1\u8fbe\u5230\u7684\u9ad8\u5ea6 \u4f60\u60f3\u60f3\u5c31\u5f97\u4e86', '\u60f3\u60f3\u5c31\u5f97\u4e86', 'attack'],
    ['\u90a3\u548b3\u4e86', '\u90a3\u548b\u4e86/\u90a3\u548b3\u4e86', 'evasion'],
    ['\u518d\u6765\u4e00\u904d\uff0cmd', 'md\u7c97\u53e3\u7f29\u5199', 'attack'],
    ['\u5f3a\u884c\u6539\u5267\u672c\uff0cUP\u771f\u9017', 'UP\u771f\u9017', 'attack'],
    ['\u95ee\u7684\u4ec0\u4e48\u51e0\u767e\u95ee\u9898', '\u95ee\u7684\u4ec0\u4e48\u51e0\u767e\u95ee\u9898', 'attack'],
    ['\u90fd\u6ca1\u5c1d\u8fc7\u561b\uff1f\u4e0d\u77e5\u9053\u81ea\u5df1\u505a\u7684\u54b8\u4e86\uff1f', '\u4e0d\u77e5\u9053\u81ea\u5df1\u505a\u7684\u54b8\u4e86', 'attack'],
    ['\u5f39\u5e55\u597d\u62c9\u89c2\u611f', '\u62c9\u89c2\u611f', 'attack'],
    ['\u5173\u952e\u8fd9\u79cd\u4e1c\u897f\u8fd8\u6709\u5927\u91cf\u7c89\u4e1d\uff0c\u8ba9\u4eba\u5934\u76ae\u53d1\u9ebb', '\u8ba9\u4eba\u5934\u76ae\u53d1\u9ebb', 'attack'],
    ['\u5267\u91cc\u4e00\u70b9\u90fd\u6ca1\u63d0', '\u4e00\u70b9\u90fd\u6ca1\u63d0', 'evidence'],
    ['12\u5e74\u7684\u4e0d\u80cc\u8fd9\u53e3\u9ed1\u9505\uff01', '\u4e0d\u80cc\u8fd9\u4e2a\u9505', 'evasion'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u6211\u521a\u5199\u4e86\u4e00\u4e2a README.md \u6587\u4ef6',
    '\u8fd9\u90e8\u6050\u6016\u7247\u7684\u6c14\u6c1b\u8ba9\u4eba\u5934\u76ae\u53d1\u9ebb',
    '\u8fd9\u9053\u83dc\u770b\u7740\u5f88\u54b8\uff0c\u53ef\u4ee5\u52a0\u70b9\u6c34',
    '\u4ec0\u4e48\u95ee\u9898\u90fd\u53ef\u4ee5\u95ee\u8001\u5e08',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 82 random audit cues', () => {
  const cases = [
    ['\u554a\uff1f\u8001\u5e08\u635e\u635e', '\u635e\u635e', 'cooperation'],
    ['\u4e0d\u8ba9\u4f60\u8bf4\uff0c\u8499\u4f4f\u5927\u5bb6\u53cc\u773c\uff0c\u4e5f\u5c31\u6ca1\u4eba\u77e5\u9053\u4e86', '\u8499\u4f4f\u5927\u5bb6\u53cc\u773c', 'evasion'],
    ['\u4f60\u4fe9\u6709\u70b9\u66a7\u6627\u4e86', '\u4f60\u4fe9\u6709\u70b9\u66a7\u6627\u4e86', 'cooperation'],
    ['\u5ddd\u5267\u662f\u5427', '\u5ddd\u5267\u662f\u5427', 'attack'],
    ['\u6469\u7faf\u5728\u5370\u5ea6\u679c\u7136\u62c9\u7a00\u4e86', '\u62c9\u7a00/\u62c9\u80ef', 'attack'],
    ['\u6545\u610f\u7684\uff0c\u5b83\u54ea\u662f\u5165\u620f\u592a\u6df1\u554a', '\u5165\u620f\u592a\u6df1', 'attack'],
    ['\u53c8\u5f00\u59cb\u80e1\u626f\u4e86\u2026\u2026\u53bb\u770b\u770b\u4eac\u4e1c\u548c\u963f\u91cc\u7684\u51fa\u6d77\u5427', '\u53c8\u5f00\u59cb\u80e1\u626f\u4e86', 'attack'],
    ['\u81ea\u7531\u554a[\u5927\u54ed]', '[\u5927\u54ed]\u53cd\u8bbd', 'attack'],
    ['\u4e24\u4e2a\u90fd\u597d\u770b\uff0c\u65e0\u5200\u653e\u5fc3\u5165\uff08\u5708\u5b50\uff09', '\u65e0\u5200\u653e\u5fc3\u5165', 'cooperation'],
    ['\u6478\u6478\u545c\u545c\u545c', '\u6478\u6478\u545c\u545c', 'cooperation'],
    ['\u535a\u5e93\u8bfa\uff0c\u5854\u5854\u5f00\uff01', '\u5854\u5854\u5f00/tatakae', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u533b\u751f\u8bf7\u7ed9\u75c5\u4eba\u6362\u65b0\u7ef7\u5e26',
    '\u4eca\u5929\u4e0b\u6c34\u9053\u5835\u4e86\uff0c\u6211\u771f\u7684\u62c9\u7a00\u4e86',
    '\u4eca\u5929\u770b\u4e86\u4e00\u573a\u5ddd\u5267\u6f14\u51fa',
    '\u6f14\u5458\u5165\u620f\u592a\u6df1\uff0c\u8868\u6f14\u5f88\u6709\u611f\u67d3\u529b',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 83 random audit cues', () => {
  const cases = [
    ['\u5047\u5192\u4f2a\u52a3\u8ba4\u4eb2\u6765\u4e86', '\u5047\u5192\u4f2a\u52a3\u8ba4\u4eb2', 'attack'],
    ['\u53c8\u4e00\u4e2a\u4e07\u4e2d\u65e0\u4e00\u7684\u5929\u624d\uff01', '\u4e07\u4e2d\u65e0\u4e00\u7684\u5929\u624d\u53cd\u8bbd', 'attack'],
    ['\u767e\u5ea6\u4e86\u4e00\u4e0b\uff0c\u5e94\u8be5\u662f\u5199\u9519\u4e86\uff0c\u662f\u7518\u725b\u81f3', '\u5199\u9519\u4e86\uff0c\u662f', 'correction'],
    ['\u65b0 \u4eba \u7c7b', '\u65b0 \u4eba \u7c7b', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u5e02\u573a\u76d1\u7ba1\u90e8\u95e8\u6253\u51fb\u5047\u5192\u4f2a\u52a3\u4ea7\u54c1',
    '\u8fd9\u4f4d\u9009\u624b\u662f\u4e07\u4e2d\u65e0\u4e00\u7684\u5929\u624d',
    '\u65b0\u4eba\u7c7b\u662f\u4e00\u4e2a\u5e74\u4ee3\u6587\u5316\u6982\u5ff5',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 84 random audit cues', () => {
  const cases = [
    ['\u786e\u5b9e\u6709\u9690\u55bb\u793e\u4f1a\u53d1\u5c55\u8fd9\u6761\u7ebf\uff0c\u6ca1\u770b\u522bbb\uff0c\u81ea\u4f5c\u806a\u660e', '\u522bbb', 'attack'],
    ['\u952e\u4ec1\u6d4b\u8bd5\u4e86', '\u952e\u4ec1', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    'BB\u673a\u662f\u4e0a\u4e16\u7eaa\u7684\u901a\u8baf\u5de5\u5177',
    '\u8fd9\u6bb5\u952e\u76d8\u548c\u4ec1\u4e49\u6ca1\u6709\u5173\u7cfb',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 85 random audit cues', () => {
  const cases = [
    ['\u4e00\u5bb6\u574f\u79cd', '\u4e00\u5bb6\u574f\u79cd', 'attack'],
    ['\u56e0\u4e3a\u72d0\u8bc1\u4e0d\u7acb\uff08', '\u72d0\u8bc1\u4e0d\u7acb', 'evasion'],
    ['\u5ddd\u4f60\u5417', '\u5ddd\u4f60\u5417', 'attack'],
    ['\u8c01\u61c2\u6211\u76f4\u63a5\u628a\u624b\u673a\u7ed9\u6254\u98de\u4e86T^T', 'ASCII emoticon tone marker', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u519c\u4e1a\u6559\u6750\u4ecb\u7ecd\u79cd\u5b50\u597d\u574f\u79cd\u7c7b',
    '\u56db\u5ddd\u4f60\u5417\u559c\u6b22\u5403\u8fa3',
    '\u8bba\u6587\u4e2d\u7684\u4f5c\u8005\u4e3e\u8bc1\u4e0d\u7acb',
  ];

  for (const text of neutralCases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'neutral');
    assert.deepEqual(result.hits, []);
  }
});

test('classifyCommentCoverage handles round 86 random audit cues', () => {
  const result = classifyCommentCoverage(
    { entries: [] },
    '\u4eba\u5bb6\u8df3\u5f97\u633a\u597d\u7684\uff0c\u4f60\u5728\u72d7\u7b11\u4ec0\u4e48',
  );
  assert.equal(result.mode, 'keyword');
  assert.ok(result.hits.some((hit) => hit.term === '\u72d7\u7b11\u4ec0\u4e48' && hit.family === 'attack'));

  const neutralCases = [
    '\u5c0f\u72d7\u7b11\u8d77\u6765\u5f88\u53ef\u7231',
    '\u4ec0\u4e48\u9e1f\u8bed\uff0c\u8fd9\u96be\u542c',
    '\u53ef\u7231\u4e0d^_^ 1',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 88 validated UTF-8 audit cues', () => {
  const humor = classifyCommentCoverage({ entries: [] }, '\u540e\u9762\u771f\u7684\u633a\u96be\u7ef7');
  assert.equal(humor.mode, 'keyword');
  assert.ok(humor.hits.some((hit) => hit.term === '\u96be\u7ef7' && hit.family === 'cooperation'));

  const insultEvasion = classifyCommentCoverage({ entries: [] }, '\u8fd9\u4e24\u5934\u51fa\u751f\u8fd9\u8f88\u5b50\u4e0d\u5f97\u597d\u4f3c');
  assert.equal(insultEvasion.mode, 'keyword');
  assert.ok(insultEvasion.hits.some((hit) => hit.term === '\u51fa\u751f...\u597d\u4f3c' && hit.family === 'attack'));

  const neutralCases = [
    '\u5b69\u5b50\u51fa\u751f\u65e5\u671f\u8fd8\u6ca1\u5b9a',
    '\u51fa\u751f\u70b9\u8fd8\u6709\u4e9b\u8bb8\u4eba\u6027\u7684\u6e29\u6696',
    '\u8fd9\u4e2a\u89c4\u5219\u597d\u4f3c\u9700\u8981\u518d\u89e3\u91ca\u4e00\u4e0b',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 90 validated UTF-8 audit cues', () => {
  const evasion = classifyCommentCoverage({ entries: [] }, '\u7701\u6d41\uff1a\u6bcf\u4e2a\u4eba\u90fd\u53e3\u542bdio');
  assert.equal(evasion.mode, 'keyword');
  assert.ok(evasion.hits.some((hit) => hit.term === '\u53e3\u542bdio' && hit.family === 'attack'));

  const properName = classifyCommentCoverage({ entries: [] }, 'DIO\u662f\u52a8\u6f2b\u89d2\u8272');
  assert.equal(properName.mode, 'neutral');
  assert.deepEqual(properName.hits, []);
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
test('classifyCommentCoverage handles round 91 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u4e5d\u654f\uff0c\u597d\u75af\u72c2', '\u4e5d\u654f', 'cooperation'],
    ['xdm\u6211\u521a\u521a\u53bb\u8bd5\u4e86\u4e0b 5070\u625b\u4e0d\u4f4f \u5efa\u8bae\u522b\u53bb\u4e86\u3002\u3002\u3002', 'xdm', 'cooperation'],
    ['\u4f60\u7956\u5b97\u5230\u6b64\u4e00\u6e38 1', '\u4f60\u7956\u5b97', 'attack'],
    ['\u521a\u5f00\u59cb\u5b66AE\u6709\u6728\u6709\u4e00\u8d77\u5b66\u7684\u5c0f\u4f19\u4f34', '\u6709\u6728\u6709', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    'XDM-100\u662f\u8bbe\u5907\u578b\u53f7',
    '\u6728\u6709\u8fd9\u79cd\u6750\u6599\u5e93\u5b58\u4e86',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 92 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u5f00\u95e8\u89c1\u53f2', '\u5f00\u95e8\u89c1\u53f2', 'cooperation'],
    [
      '\u76f2\u4eba\uff1a\u5176\u5b9e\u6211\u662f\u76f2\u5c71\uff0c\u6211\u542c\u89c1\u8d3c\u8fdb\u6765\u76f4\u63a5\u7ed9\u4ed6\u6765\u4e86\u4e00\u5957\u9a6c\u6c0f\u4e09\u89d2\u6740',
      '\u9a6c\u6c0f\u4e09\u89d2\u6740',
      'cooperation',
    ],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u8bf7\u5f00\u95e8\u89c1\u5c71\u8bf4\u91cd\u70b9',
    '\u6570\u5b66\u8bfe\u4eca\u5929\u8bb2\u4e09\u89d2\u5f62',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 93 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u8fd9\u662f\u8e0f\u9a6c\u50ac\u6cea', '\u8e0f\u9a6c', 'attack'],
    ['\u4e94\u4e2a\u50bb\ud83d\udd8a\ufe0f__ __ __', '\u50bb\ud83d\udd8a\ufe0f', 'attack'],
    ['\u4e0d\u884c\u5417\uff1f\uff1f\uff01\uff01\uff01\uff08\u72d7\u5934\uff09', '\u72d7\u5934\u4fdd\u547d/\u53cd\u8bbd\u8bed\u6c14', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u72d7\u72d7\u5934\u671d\u4e0b\u662f\u5728\u9080\u8bf7\u4f60\u4e00\u8d77\u73a9',
    '\u6211\u4eca\u5929\u4e70\u4e86\u4e00\u652f\u7b14',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 94 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u6c99\u58c1\u4e8c\u6b21\u5143', '\u6c99\u58c1/\u50bb\u903c', 'attack'],
    ['\u65e9\u4e59\u5973\u82bd\u4e9a\u91cc\u548c\u7262\u5927\u7684\u5973\u513f\u2193', '\u7262\u5927', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u6c99\u58c1\u5730\u8c8c\u4ecb\u7ecd',
    '\u6c99\u58c1\u5efa\u7b51\u8bbe\u8ba1',
    '\u76d1\u7262\u5927\u95e8\u5df2\u7ecf\u5173\u4e0a\u4e86',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 95 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u8fd9\u4e2a\u4eba\u591a\u635e\u554a', '\u635e', 'attack'],
    ['\u8fd9\u4e9b\u9500\u552e\u8bdd\u672f\u597d\u719f\u6089 \u8bed\u6c14\u4e5f\u90fd\u5f88\u5178\uff0c\u786c\u51f9\u51fa\u8001\u94b1\u81ea\u4fe1\u7684\u611f\u89c9', '\u5f88\u5178/\u5178\u4e2d\u5178', 'attack'],
    ['\u8fd9\u4e9b\u9500\u552e\u8bdd\u672f\u597d\u719f\u6089 \u8bed\u6c14\u4e5f\u90fd\u5f88\u5178\uff0c\u786c\u51f9\u51fa\u8001\u94b1\u81ea\u4fe1\u7684\u611f\u89c9', '\u786c\u51f9', 'attack'],
    ['\u6211\u5927\u80e1\u5efa\u4e5f\u662f, \u4e0d\u8fc7\u597d\u5728\u6211\u4eec\u53ef\u4ee5\u7528\u6587\u5b57\u4ea4\u6d41,\u7b11', '\u7b11\u8bed\u6c14\u6807\u8bb0', 'cooperation'],
    ['\u9f9a\u5e7f\u7984\uff0c\u6211\u771f\u7684\u7231\u4f60\u554a\uff0c\u4f60\u77e5\u9053\u5417 \u7ad9\u4e00\u79d2\u65e0\u4eba\u5c4f\u5e55', '\u7ad9\u4e00\u79d2', 'cooperation'],
    ['\u524d\u65b9\u6253\u5206\uff0c\u6ce8\u610f\u52ff\u624b\u6ed1\uff01', '\u624b\u6ed1', 'evasion'],
    ['\u9b54\u65b9\uff1a\u4f60\u662f\u5f1f\u5f1f', '\u5f1f\u5f1f\u8d2c\u4e49', 'attack'],
    ['\u8d5b\u535a\u516d\u827a', '\u8d5b\u535a\u516d\u827a', 'cooperation'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u4eca\u5929\u53bb\u6cb3\u91cc\u635e\u9c7c',
    '\u8fd9\u662f\u7ecf\u5178\u6848\u4f8b',
    '\u5f1f\u5f1f\u4eca\u5929\u56de\u5bb6\u4e86',
    '\u95e8\u53e3\u7ad9\u4e00\u79d2\u518d\u8d70',
    '\u624b\u6ed1\u6454\u5012\u4e86',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});

test('classifyCommentCoverage handles round 96 validated UTF-8 audit cues', () => {
  const cases = [
    ['\u53fd\u53fd\u7ea2\u6e29\u7684\u65f6\u5019\u6211\u8868\u7535\u8bdd\u4e5f\u54cd\u4e86', '\u7ea2\u6e29', 'attack'],
    ['\u65f6\u957f\u7231\u4e86\u7231\u4e86', '\u7231\u4e86\u7231\u4e86', 'cooperation'],
    ['fmvp\u542b\u91d1\u91cf\u61c2\u5f97\u90fd\u61c2', '\u61c2\u5f97\u90fd\u61c2', 'evasion'],
    ['\u795e\u4eba UP', '\u795e\u4eba', 'cooperation'],
    ['\u5c0f\u8111\u840e\u7f29\u4e86', '\u5c0f\u8111\u840e\u7f29', 'attack'],
    ['\u6f0f\u7a0e\u72c2\u9b54', '\u72c2\u9b54', 'attack'],
  ];

  for (const [text, term, family] of cases) {
    const result = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(result.mode, 'keyword');
    assert.ok(result.hits.some((hit) => hit.term === term && hit.family === family));
  }

  const neutralCases = [
    '\u6c34\u676f\u7ea2\u6e29\u63d0\u793a',
    '\u6211\u771f\u7684\u604b\u7231\u4e86',
    '\u533b\u751f\u8bf4\u662f\u5c0f\u8111\u840e\u7f29',
    '\u5b66\u4e60\u72c2\u9b54',
  ];

  for (const text of neutralCases) {
    const neutral = classifyCommentCoverage({ entries: [] }, text);
    assert.equal(neutral.mode, 'neutral');
    assert.deepEqual(neutral.hits, []);
  }
});
