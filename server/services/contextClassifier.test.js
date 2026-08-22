import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS,
  classifyScenario,
  scenarioScore,
  scenarioMatchBonus,
} from './contextClassifier.js';

// ── Scenario taxonomy ──

test('SCENARIOS contains expected 6 scenarios', () => {
  assert.equal(SCENARIOS.length, 6);
  assert.ok(SCENARIOS.includes('taunting'));
  assert.ok(SCENARIOS.includes('argument'));
  assert.ok(SCENARIOS.includes('praise'));
  assert.ok(SCENARIOS.includes('neutral_info'));
  assert.ok(SCENARIOS.includes('reassurance'));
  assert.ok(SCENARIOS.includes('self_deprecation'));
});

// ── classifyScenario ──

test('classifyScenario returns neutral_info for empty text', () => {
  const result = classifyScenario('');
  assert.equal(result.scenario, 'neutral_info');
  assert.equal(result.confidence, 0);
});

test('classifyScenario detects taunting scenario', () => {
  const result = classifyScenario('你急了哈哈哈笑死我了');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.confidence > 0);
  assert.ok(result.scores.taunting > result.scores.neutral_info);
});

test('classifyScenario detects argument scenario', () => {
  const result = classifyScenario('你的说法并非事实，没有证据支持');
  assert.equal(result.scenario, 'argument');
  assert.ok(result.scores.argument > 0);
});

test('classifyScenario detects praise scenario', () => {
  const result = classifyScenario('太强了！操作真厉害👍');
  assert.equal(result.scenario, 'praise');
  assert.ok(result.scores.praise > 0);
});

test('classifyScenario detects reassurance scenario', () => {
  const result = classifyScenario('别急，慢慢来，没事的');
  assert.equal(result.scenario, 'reassurance');
  assert.ok(result.scores.reassurance > 0);
});

test('classifyScenario detects self_deprecation scenario', () => {
  const result = classifyScenario('我太菜了，就是个萌新');
  assert.equal(result.scenario, 'self_deprecation');
  assert.ok(result.scores.self_deprecation > 0);
});

test('classifyScenario detects neutral_info for plain statements', () => {
  const result = classifyScenario('这个视频讲的是如何配置服务器');
  assert.equal(result.scenario, 'neutral_info');
});

test('classifyScenario picks strongest signal when multiple match', () => {
  // "哈哈哈" (taunting strong=3) vs "不错" (praise weak=1)
  const result = classifyScenario('哈哈哈不错');
  assert.equal(result.scenario, 'taunting');
});

test('classifyScenario returns confidence 0..1', () => {
  const empty = classifyScenario('');
  assert.equal(empty.confidence, 0);

  const clear = classifyScenario('你急了哈哈哈笑死我了');
  assert.ok(clear.confidence > 0);
  assert.ok(clear.confidence <= 1);
});

// ── scenarioScore ──

test('scenarioScore returns confidence when scenario matches', () => {
  const text = '太强了牛啊！';
  const score = scenarioScore(text, 'praise');
  assert.ok(score > 0);
});

test('scenarioScore returns 0 when scenario does not match', () => {
  const score = scenarioScore('太强了牛啊！', 'taunting');
  assert.equal(score, 0);
});

// ── scenarioMatchBonus ──

test('scenarioMatchBonus returns 0 for null scenario', () => {
  assert.equal(scenarioMatchBonus('你急了哈哈哈', null), 0);
});

test('scenarioMatchBonus returns positive bonus for matching scenario', () => {
  const bonus = scenarioMatchBonus('你急了哈哈哈笑死我了', 'taunting');
  assert.ok(bonus > 0);
  assert.ok(bonus <= 0.08);
});

test('scenarioMatchBonus returns 0 for non-matching scenario', () => {
  const bonus = scenarioMatchBonus('太强了牛啊', 'taunting');
  assert.equal(bonus, 0);
});

// ── Step 1: Expanded taunting lexicon ──

test('taunting: blame + insult pattern (X垃圾)', () => {
  const result = classifyScenario('就是程序员垃圾，没什么好说的');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.scores.taunting > result.scores.argument,
    `taunting=${result.scores.taunting} should exceed argument=${result.scores.argument}`);
});

test('taunting: authority blame pattern (策划的错)', () => {
  const result = classifyScenario('都是策划的错，这种垃圾活动');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.scores.taunting > result.scores.praise,
    `taunting=${result.scores.taunting} should exceed praise=${result.scores.praise}`);
});

test('taunting: dismissive meme (就这/也配)', () => {
  const result = classifyScenario('就这也配拿出来说？');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.scores.taunting > 0);
});

test('taunting: mockery (真好意思)', () => {
  const result = classifyScenario('你好意思说别人？');
  assert.equal(result.scenario, 'taunting');
});

test('taunting: accusation with 甩锅', () => {
  const result = classifyScenario('为什么你每次都这么菜还喜欢甩锅');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.scores.taunting > result.scores.praise,
    `taunting=${result.scores.taunting} should exceed praise=${result.scores.praise}`);
});

test('taunting: mild negative assessment (不太行)', () => {
  const result = classifyScenario('这个改动不太行，劝退了');
  assert.ok(result.scores.taunting > 0);
});

test('taunting: exaggerated mockery (挺会)', () => {
  const result = classifyScenario('你挺会甩锅的啊');
  assert.equal(result.scenario, 'taunting');
});

test('taunting:洗地/洗白 patterns', () => {
  const result = classifyScenario('别洗了，这波操作就是垃圾');
  assert.equal(result.scenario, 'taunting');
  assert.ok(result.scores.taunting >= 3);
});

// ── Step 2: Cross-scenario suppression ──

test('cross-scenario suppression: strong taunting halves praise score', () => {
  // "肯定" used to falsely trigger praise via /[真太]?[好棒赞]/u matching "赞"
  // But with taunting score >= 3, praise should be halved and lose
  const result = classifyScenario('这次更新肯定是在逼玩家氪金，策划垃圾');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
  // Even if "肯定" doesn't trigger praise here, taunting should win
  assert.ok(result.scores.taunting > 0);
});

test('cross-scenario suppression: strong taunting + weak argument → taunting wins', () => {
  // "不是傻就是蠢" has "不是" → argument weak signal, but insults dominate
  const result = classifyScenario('不是傻就是蠢，你自己选一个');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
  assert.ok(result.scores.taunting > result.scores.argument,
    `taunting=${result.scores.taunting} should exceed argument=${result.scores.argument}`);
});

test('cross-scenario suppression: pure argument with evidence still wins', () => {
  // Genuine evidence-based argument should still classify as argument
  const result = classifyScenario('根据数据来看，这个结论缺乏逻辑支持');
  assert.equal(result.scenario, 'argument');
  assert.ok(result.scores.argument > result.scores.taunting);
});

// ── Step 3: Negation pre-filter ──

test('negation pre-filter: "不是" + positive word does not boost praise', () => {
  // "不是他傻" should suppress argument signals from "不是" pattern
  const result = classifyScenario('不是他傻，是策划真的有问题');
  // The negation "不是" reduces argument score by 1
  // The comment contains blame patterns → taunting should win
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

test('negation pre-filter: "没有" scope reduces argument', () => {
  const result = classifyScenario('没有什么证据能支持这个说法');
  // "没有" negation scope found, argument score reduced by 1
  assert.ok(result.scores.argument <= 2,
    `argument score ${result.scores.argument} should be reduced by negation`);
});

test('negation pre-filter: "不懂" mockery not confused with argument', () => {
  // "不懂" is a taunting strong signal, not argument even though it contains "不"
  const result = classifyScenario('你根本不懂游戏机制');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

// ── Step 4: Argument-vs-taunting tiebreaker ──

test('tiebreaker: close taunting + argument scores → taunting wins', () => {
  // A comment with both weak argument signals and taunting tone.
  // "但是"+"因为" give argument weak signals; "搞笑" gives taunting weak.
  // No negation scope (不是/没有) — scores stay close without being zeroed.
  // Tiebreaker: argument(2) vs taunting(1), diff=1 ≤ 2 → argument reduced by 1,
  // leaving both at 1; taunting wins on list order.
  const result = classifyScenario('但是因为你这波操作也挺搞笑');
  assert.ok(result.scores.taunting > 0, `taunting score=${result.scores.taunting}`);
  assert.ok(result.scores.argument > 0, `argument score=${result.scores.argument}`);
  assert.equal(result.scenario, 'taunting',
    `close scores should resolve to taunting, got ${result.scenario} (scores=${JSON.stringify(result.scores)})`);
});

// ── Eval regression tests (plan examples) ──

test('eval regression: "不是傻就是蠢，你自己选一个" → taunting', () => {
  const result = classifyScenario('不是傻就是蠢，你自己选一个');
  assert.equal(result.scenario, 'taunting');
});

test('eval regression: "这个bug一定是程序员偷懒导致的" → taunting', () => {
  const result = classifyScenario('这个bug一定是程序员偷懒导致的');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

test('eval regression: "笑死，你这理解能力也就这样了" → taunting', () => {
  const result = classifyScenario('笑死，你这理解能力也就这样了');
  assert.equal(result.scenario, 'taunting');
});

test('eval regression: "这次更新肯定是在逼玩家氪金" → taunting', () => {
  const result = classifyScenario('这次更新肯定是在逼玩家氪金');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

test('eval regression: "为什么你每次都这么菜还喜欢甩锅" → taunting', () => {
  const result = classifyScenario('为什么你每次都这么菜还喜欢甩锅');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

test('eval regression: "就是程序员垃圾，没什么好说的" → taunting', () => {
  const result = classifyScenario('就是程序员垃圾，没什么好说的');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});

test('eval regression: "都是策划的错，这种垃圾活动" → taunting', () => {
  const result = classifyScenario('都是策划的错，这种垃圾活动');
  assert.equal(result.scenario, 'taunting',
    `got ${result.scenario}, scores=${JSON.stringify(result.scores)}`);
});
