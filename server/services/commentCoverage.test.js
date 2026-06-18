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
  assert.equal(selfNovice.mode, 'neutral');
  assert.equal(selfNovice.hits.length, 0);
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
