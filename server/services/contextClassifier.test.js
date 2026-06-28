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
