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
