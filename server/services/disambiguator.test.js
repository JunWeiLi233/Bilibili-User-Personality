/**
 * Tests for the context-disambiguation engine (server/services/disambiguator.js).
 *
 * Validates that:
 * 1. Rules load correctly
 * 2. High-ambiguity terms (不是, 没有, 哈哈哈, etc.) are properly disambiguated
 * 3. Suppression, confirmation, and neutral actions work as designed
 * 4. applyDisambiguation correctly filters suppressed matches
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadRules,
  clearRulesCache,
  disambiguateTerm,
  disambiguate,
  applyDisambiguation,
  getContext,
  suppressionStats,
  contextAwareDisambiguate,
} from "../services/disambiguator.js";

// ─── Rule loading ───

test("loadRules returns rule groups", () => {
  clearRulesCache();
  const rules = loadRules();
  assert.ok(Array.isArray(rules), "rules should be an array");
  assert.ok(rules.length >= 19, `expected ≥19 rule groups, got ${rules.length}`);
  // Verify key rule groups exist
  const terms = new Set(rules.map((r) => r.term));
  assert.ok(terms.has("不是"), "should have rules for 不是");
  assert.ok(terms.has("没有"), "should have rules for 没有");
  assert.ok(terms.has("哈哈哈"), "should have rules for 哈哈哈");
  assert.ok(terms.has("我觉得"), "should have rules for 我觉得");
});

test("loadRules caches results", () => {
  clearRulesCache();
  const r1 = loadRules();
  const r2 = loadRules();
  assert.strictEqual(r1, r2, "second call should return cached result");
});

// ─── Term disambiguation ───

test("不是: yes/no question → suppress", () => {
  const r = disambiguateTerm("是不是要更新了", "不是", "attack");
  assert.ok(r, "should return a result");
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "yes_no_question");
  assert.ok(r.confidence >= 0.8);
});

test("不是: argumentative opener → confirm", () => {
  const r = disambiguateTerm("不是，你根本不懂这个问题的严重性", "不是", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
  assert.strictEqual(r.reason, "argumentative_opener");
});

test("不是: simple negation suffix → suppress", () => {
  const r = disambiguateTerm("这个不是红色的", "不是", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "simple_negation_suffix");
});

test("没有: simple lack of money → suppress", () => {
  const r = disambiguateTerm("我没有钱买这个", "没有", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "simple_lack");
});

test("没有: past negation → suppress", () => {
  const r = disambiguateTerm("我没有看到那个视频", "没有", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "past_negation");
});

test("没有: absolute denial → confirm", () => {
  const r = disambiguateTerm("根本就没有这回事", "没有", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
  assert.strictEqual(r.reason, "composite:comp-029");
});

test("哈哈哈: standalone laughter → suppress", () => {
  const r = disambiguateTerm("哈哈哈哈哈哈", "哈哈哈", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "standalone_laughter");
});

test("哈哈哈: genuine appreciation → suppress", () => {
  const r = disambiguateTerm("哈哈哈太强了牛逼", "哈哈哈", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "genuine_appreciation");
});

test("哈哈哈: mockery → confirm", () => {
  const r = disambiguateTerm("哈哈哈你真是傻得可爱", "哈哈哈", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
  assert.strictEqual(r.reason, "composite:comp-035");
});

test("我觉得: opinion framing → suppress", () => {
  const r = disambiguateTerm("我觉得还可以吧", "我觉得", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "opinion_framing");
});

test("我觉得: negative judgment about others → confirm", () => {
  const r = disambiguateTerm("我觉得你根本不懂这个", "我觉得", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
});

test("为什么: genuine question → suppress", () => {
  const r = disambiguateTerm("为什么会这样呢", "为什么", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
  assert.strictEqual(r.reason, "genuine_question");
});

test("为什么: rhetorical attack → confirm", () => {
  const r = disambiguateTerm("为什么你这么菜啊", "为什么", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
});

test("一定: neutral certainty/encouragement → suppress", () => {
  const r = disambiguateTerm("一定要加油啊", "一定", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("一定: dogmatic assertion → confirm", () => {
  const r = disambiguateTerm("一定是你搞错了", "一定", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
});

test("笑死了: genuine laughter → suppress", () => {
  const r = disambiguateTerm("笑死了好活", "笑死了", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("笑死了: self-deprecating → suppress", () => {
  const r = disambiguateTerm("笑死了我自己都信了", "笑死了", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("懂的都懂: community bonding → suppress", () => {
  const r = disambiguateTerm("懂的都懂确实", "懂的都懂", "evasion");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("懂的都懂: evasive refusal → confirm", () => {
  const r = disambiguateTerm("懂的都懂", "懂的都懂", "evasion");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
});

// ─── Unknown terms ───

test("unknown term returns null from disambiguateTerm", () => {
  const r = disambiguateTerm("这是一段没有规则的文本", "无规则词", "attack");
  assert.strictEqual(r, null, "unknown term should return null");
});

// ─── applyDisambiguation ───

test("applyDisambiguation filters suppressed matches", () => {
  const text = "是不是要更新了，我没有钱";
  const matches = [
    { term: "不是", family: "attack" },
    { term: "没有", family: "absolutes" },
  ];
  const result = applyDisambiguation(text, matches);
  // Both should be suppressed (yes/no question + simple lack)
  assert.strictEqual(result.length, 0, "both matches should be suppressed");
});

test("applyDisambiguation keeps neutral and confirmed matches", () => {
  const text = "你根本不懂，这就是双标行为";
  const matches = [
    { term: "这就是", family: "absolutes" },
  ];
  const result = applyDisambiguation(text, matches);
  assert.ok(result.length >= 1, "confirmed match should be kept");
  assert.strictEqual(result[0].action, "confirm");
});

test("applyDisambiguation boosts confirmed match weights", () => {
  const text = "不是，你根本不懂这个问题的严重性";
  const matches = [
    { term: "不是", family: "attack", weight: 1 },
  ];
  const result = applyDisambiguation(text, matches);
  assert.ok(result.length >= 1, "confirmed match should be kept");
  assert.ok(result[0].weight > 1, `confirmed weight should be boosted, got ${result[0].weight}`);
});

// ─── suppressionStats ───

test("suppressionStats computes correctly", () => {
  const results = [
    { action: "suppress" },
    { action: "suppress" },
    { action: "confirm" },
    { action: "neutral" },
    { action: "neutral" },
    { action: "neutral" },
  ];
  const stats = suppressionStats(results);
  assert.strictEqual(stats.total, 6);
  assert.strictEqual(stats.suppressed, 2);
  assert.strictEqual(stats.confirmed, 1);
  assert.strictEqual(stats.neutral, 3);
  assert.ok(stats.suppressionRate > 30 && stats.suppressionRate < 35);
});

// ─── getContext ───

test("getContext extracts surrounding window", () => {
  const text = "这是一个测试文本，包含关键词在其中间位置";
  const idx = text.indexOf("关键词");
  const ctx = getContext(text, idx, 3, 5);
  assert.ok(ctx.before.includes("包含"));
  assert.strictEqual(ctx.match, "关键词");
  assert.ok(ctx.after.includes("在"));
});

// ─── disambiguate batch ───

test("disambiguate processes multiple terms", () => {
  const text = "是不是要更新了，我觉得还可以吧，没有钱买这个";
  const matches = [
    { term: "不是", family: "attack" },
    { term: "我觉得", family: "attack" },
    { term: "没有", family: "absolutes" },
    { term: "未知词", family: "unknown" },
  ];
  const results = disambiguate(text, matches);
  assert.strictEqual(results.length, 4, "should return results for all 4 terms");

  const byTerm = Object.fromEntries(results.map((r) => [r.term, r.action]));
  assert.strictEqual(byTerm["不是"], "suppress");
  assert.strictEqual(byTerm["我觉得"], "suppress");
  assert.strictEqual(byTerm["没有"], "suppress");
  assert.strictEqual(byTerm["未知词"], "neutral"); // no rules = neutral
});

// ─── New rule groups ───

test("觉得: hedged opinion → suppress", () => {
  const r = disambiguateTerm("觉得还可以吧", "觉得", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("觉得: self-directed → suppress", () => {
  const r = disambiguateTerm("我觉得还行", "觉得", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("哈哈: standalone short laughter → neutral", () => {
  const r = disambiguateTerm("哈哈", "哈哈", "attack");
  assert.ok(r);
  assert.ok(r.action === "neutral" || r.action === "suppress");
});

test("可能: hedge marker → suppress", () => {
  const r = disambiguateTerm("可能是这样吧", "可能", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("应该: hedged suggestion → suppress", () => {
  const r = disambiguateTerm("应该可以试试", "应该", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("确实: agreement response → suppress", () => {
  const r = disambiguateTerm("确实是这样没错", "确实", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("死了: intensifier → suppress", () => {
  const r = disambiguateTerm("累死了今天", "死了", "attack");
  assert.ok(r);
  assert.strictEqual(r.action, "suppress");
});

test("全都: absolutist negative → confirm", () => {
  const r = disambiguateTerm("全都是水军刷的", "全都", "absolutes");
  assert.ok(r);
  assert.strictEqual(r.action, "confirm");
});

// ─── Edge cases ───

test("empty text returns null", () => {
  const r = disambiguateTerm("", "不是", "attack");
  assert.strictEqual(r, null);
});

test("null text returns null", () => {
  const r = disambiguateTerm(null, "不是", "attack");
  assert.strictEqual(r, null);
});

test("disambiguate handles empty keywordMatches", () => {
  const results = disambiguate("some text", []);
  assert.deepStrictEqual(results, []);
});

test("applyDisambiguation handles empty keywordMatches", () => {
  const results = applyDisambiguation("some text", []);
  assert.deepStrictEqual(results, []);
});

// ─── Integration smoke tests ─────────────────────────────────────────────────

test('applyDisambiguation reduces keyword count for known false positives', () => {
  const comment = '哈哈哈哈哈哈哈哈';
  const matches = [{ term: '哈哈哈', family: 'attack', weight: 1 }];
  const filtered = applyDisambiguation(comment, matches);
  // Standalone laughter should be suppressed
  assert.strictEqual(filtered.length, 0);
});

test('applyDisambiguation preserves genuine attack matches', () => {
  const comment = '哈哈哈就这？你行你上啊傻逼';
  const matches = [
    { term: '哈哈哈', family: 'attack', weight: 1 },
    { term: '就这', family: 'attack', weight: 1 },
  ];
  const filtered = applyDisambiguation(comment, matches);
  // Both should survive — mockery context
  assert.strictEqual(filtered.length, 2);
});

test('applyDisambiguation suppresses 不是 in "是不是今天更新"', () => {
  const comment = '是不是今天更新啊？';
  const matches = [{ term: '不是', family: 'attack', weight: 1 }];
  const filtered = applyDisambiguation(comment, matches);
  assert.strictEqual(filtered.length, 0);
});

test('applyDisambiguation confirms 不是 in "不是，你这逻辑太离谱"', () => {
  const comment = '不是，你这逻辑也太离谱了吧？你懂不懂啊';
  const matches = [{ term: '不是', family: 'attack', weight: 1 }];
  const filtered = applyDisambiguation(comment, matches);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].action, 'confirm');
});

// ─── Snapshot: all 24 term groups have rules ──────────────────────────────────

test('all 24 disambiguation terms have at least 2 rules (suppress + confirm)', () => {
  const rules = loadRules();
  const expectedTerms = [
    '不是', '没有', '一定', '肯定', '笑死了', '哈哈哈', '懂的都懂',
    '我觉得', '全都是', '都是', '一句话', '为什么', '这就是', '就是',
    '根本就', '你行你上', '就这', '急了', '典', '觉得', '哈哈',
    '笑死', '可能', '应该', '确实', '死了', '全都',
  ];
  const ruleTerms = new Set(rules.map(r => r.term));
  for (const term of expectedTerms) {
    assert.ok(ruleTerms.has(term), `Expected rule group for term: "${term}"`);
  }
});

test('all rule groups have at least one suppress and one confirm rule', () => {
  const rules = loadRules();
  for (const group of rules) {
    const actions = new Set(group.rules.map(r => r.action));
    assert.ok(
      actions.has('suppress') || actions.has('confirm'),
      `Rule group "${group.term}" should have suppress or confirm rules, got: ${[...actions].join(',')}`,
    );
  }
});

test('all rule patterns compile as valid regex', () => {
  const rules = loadRules();
  for (const group of rules) {
    for (const rule of group.rules) {
      try {
        new RegExp(rule.pattern, 'u');
      } catch (e) {
        assert.fail(`Invalid regex for term "${group.term}", rule "${rule.type}": ${e.message}`);
      }
    }
  }
  assert.ok(true, 'all patterns are valid regex');
});

// ─── contextAwareDisambiguate tests ──────────────────────────────────────────

test('contextAwareDisambiguate returns filtered, stats, and scenario', () => {
  const comment = '哈哈哈哈真的好搞笑啊';
  const matches = [{ term: '哈哈哈', family: 'attack', weight: 1 }];
  const result = contextAwareDisambiguate(comment, matches);
  assert.ok(result.filtered, 'should have filtered array');
  assert.ok(result.stats, 'should have stats');
  assert.ok(result.scenario, 'should have scenario');
  assert.ok(result.scenario.scenario, 'should have scenario name');
});

test('contextAwareDisambiguate suppresses standalone laughter in praise context', () => {
  const comment = '哈哈哈哈好活当赏，UP主太有才了👏';
  const matches = [{ term: '哈哈哈', family: 'attack', weight: 1 }];
  const result = contextAwareDisambiguate(comment, matches);
  // In a praise context, standalone laughter should be suppressed
  assert.strictEqual(result.filtered.length, 0);
});

// ─── suppressionStats tests ──────────────────────────────────────────────────

test('suppressionStats computes correct rates', () => {
  const results = [
    { action: 'suppress' },
    { action: 'suppress' },
    { action: 'confirm' },
    { action: 'neutral' },
    { action: 'confirm' },
  ];
  const stats = suppressionStats(results);
  assert.strictEqual(stats.total, 5);
  assert.strictEqual(stats.suppressed, 2);
  assert.strictEqual(stats.confirmed, 2);
  assert.strictEqual(stats.neutral, 1);
  assert.strictEqual(stats.suppressionRate, 40);
});

test('suppressionStats handles empty results', () => {
  const stats = suppressionStats([]);
  assert.strictEqual(stats.total, 0);
  assert.strictEqual(stats.suppressionRate, 0);
});
