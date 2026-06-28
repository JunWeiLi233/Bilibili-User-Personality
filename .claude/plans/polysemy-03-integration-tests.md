# Plan 03: Integration Hardening + Test Expansion

**Status**: Not started | **Estimate**: ~75 min | **Target**: Test coverage from 48 → 120+ cases; wire disambiguator + classifier into `commentCoverage.js`

## Problem

The disambiguator and context classifier were built as standalone modules with isolated tests. Two gaps remain:

1. **Test coverage is thin**: 40 unit tests + 48 eval cases cover only 16 of 24 terms. The remaining 8 terms (全都, 根本就是, 你行你上, 就这, 哈哈, 可能, 应该, 确实, 死了) have rules but no eval cases. Unknown how well they perform on confused examples.

2. **No integration**: `applyDisambiguation()` is called nowhere in the production pipeline. `commentCoverage.js` (the keyword matching engine that feeds the scoring system) does NOT invoke the disambiguator. The rules exist but aren't wired in.

3. **No scenario bias**: The context classifier's scenario output is never used to bias disambiguation confidence. `scenarioMatchBonus()` exists in `contextClassifier.js` but is never called.

## Step 1: Expand eval coverage to all 24 terms — 30 min

### 1a. Add 24 confused-example test cases for uncovered terms

Add cases to `server/scripts/evalPolysemy.js` for the 8 terms missing from the eval:

| Term | Family | Case A (suppress/neutral) | Case B (confirm) |
|---|---|---|---|
| 全都 | absolutes | "全都在讨论这个问题" (enumeration) | "全都是水军在带节奏" (absolutist negative) |
| 根本就是 | absolutes | "这根本就是个误会" (emphatic explanation) | "根本就是智商税，骗钱的" (dogmatic denial) |
| 你行你上 | attack | "你行你上啊😂开个玩笑" (playful banter) | "你行你上，别在这指指点点" (defensive dismissal) |
| 就这 | attack | "就这水平还敢教人？" (dismissive) | "就这？我自己也经常这样" (self-deprecating) |
| 哈哈 | attack | "哈哈好厉害" (genuine appreciation) | "哈哈傻了吧" (mockery) |
| 可能 | absolutes | "可能会有点延迟" (uncertainty) | "可能完全就是骗人的" (disguised absolute) |
| 应该 | absolutes | "应该没问题吧" (hedged) | "应该所有人都必须遵守" (moralistic) |
| 死了 | attack | "笑死了这个好有趣" (intensifier) | "去死了算了" (literal threat context) |

### 1b. Add 12 edge cases for already-covered terms

| Case | Term | Text | Challenge |
|---|---|---|---|
| 不是-F | 不是 | "不是我说，这也太差了吧" | Idiomatic "不是我说" — self-deprecating opener |
| 没有-F | 没有 | "没有十年脑血栓想不出这操作" | Hyperbolic mockery disguised as "没有" statement |
| 一定-F | 一定 | "你一定是没玩过才这么说" | 一定 + accusation about another's experience |
| 笑死-E | 笑死 | "笑死个人" | Regional variant of 笑死我了 |
| 觉得-D | 觉得 | "我不觉得这有什么问题" | Negated 觉得 — different from "我觉得" |
| 为什么-D | 为什么 | "为什么就没人说这个问题呢" | Rhetorical with universal quantifier |
| 确实-C | 确实 | "确实不太行，但是也不至于这么差" | Concessive 确实 with mixed sentiment |
| 就是-C | 就是 | "就是说白了，就是割韭菜" | 就是 + colloquial intensifier + negative label |
| 都是-C | 都是 | "大家都是成年人，别这么幼稚" | "大家都是" — inclusive identification |
| 肯定-C | 肯定 | "我肯定选第一个，第二个太拉了" | Personal preference (should be suppressed) |
| 没有-G | 没有 | "不是没有道理，但也不全对" | Double negation "不是没有" — partial agreement |
| 一句话-C | 一句话 | "一句话，我不推荐" | Bare conclusive opener with neutral content |

## Step 2: Wire `applyDisambiguation` into `commentCoverage.js` — 20 min

### 2a. Find the integration point

`server/services/commentCoverage.js` (or wherever `vocabularyMarks` are computed) currently matches keywords against comment text. After matching, it should call `applyDisambiguation()` to filter/suppress false-positive matches.

```javascript
// In commentCoverage.js (or the relevant keyword matching module):

import { applyDisambiguation } from './disambiguator.js';

// After computing raw keywordMatches for a comment:
const filteredMatches = applyDisambiguation(commentText, rawKeywordMatches);

// Use filteredMatches for density computation instead of rawKeywordMatches
```

### 2b. Add a feature flag

```javascript
// In server/services/commentCoverage.js:
const ENABLE_DISAMBIGUATION = process.env.BILIBILI_DISAMBIGUATION !== '0'; // default on
```

This allows A/B comparison: score the same corpus with and without disambiguation, compare axis score distributions to measure impact.

### 2c. Add logging

Log suppression statistics per batch to verify the disambiguator is working in production:

```javascript
import { suppressionStats } from './disambiguator.js';

// After processing a batch:
const stats = suppressionStats(allResults);
console.log(`[disambiguator] Batch: ${stats.total} matches, ${stats.suppressed} suppressed (${stats.suppressionRate}%), ${stats.confirmed} confirmed`);
```

## Step 3: Wire scenario bias into disambiguation confidence — 15 min

### 3a. Create `contextAwareDisambiguation()` wrapper

```javascript
// In server/services/disambiguator.js:

import { classifyScenario } from './contextClassifier.js';

/**
 * Disambiguate with scenario-aware confidence adjustment.
 * If the comment's classified scenario aligns with the disambiguation action,
 * boost confidence. If it contradicts, reduce confidence.
 */
export function contextAwareDisambiguate(commentText, keywordMatches) {
  const results = disambiguate(commentText, keywordMatches);
  const scenario = classifyScenario(commentText);

  return results.map(r => {
    let adjustedConfidence = r.confidence;

    // Taunting scenario → boost confirm confidence, reduce suppress confidence
    if (scenario.scenario === 'taunting' && r.action === 'confirm') {
      adjustedConfidence = Math.min(1, r.confidence + 0.1 * scenario.confidence);
    }
    if (scenario.scenario === 'praise' && r.action === 'suppress') {
      adjustedConfidence = Math.min(1, r.confidence + 0.1 * scenario.confidence);
    }
    // Self-deprecation → suppress is more likely correct
    if (scenario.scenario === 'self_deprecation' && r.action === 'suppress') {
      adjustedConfidence = Math.min(1, r.confidence + 0.08 * scenario.confidence);
    }

    return { ...r, confidence: Math.round(adjustedConfidence * 100) / 100, scenario: scenario.scenario };
  });
}
```

### 3b. Test with eval cases

Re-run the eval through `contextAwareDisambiguate()` instead of bare `disambiguateTerm()` and verify that:
- Taunting-scenario comments get higher confidence on `confirm` actions
- Praise-scenario comments get higher confidence on `suppress` actions
- No case flips from correct to wrong due to scenario bias

## Step 4: Add regression tests — 10 min

### 4a. Snapshot test for all 24 terms

Add a test in `disambiguator.test.js` that loads all rules and verifies each term group has:
- At least 2 rules (one suppress, one confirm)
- No duplicate rule types within a term group
- All patterns compile as valid regex

### 4b. Integration smoke test

```javascript
// In a new test file or added to disambiguator.test.js:
test('applyDisambiguation reduces keyword count for known false positives', () => {
  const comment = '哈哈哈哈哈哈哈哈';
  const matches = [{ term: '哈哈哈', family: 'attack', weight: 1 }];
  const filtered = applyDisambiguation(comment, matches);
  assert.strictEqual(filtered.length, 0); // standalone laughter should be suppressed
});

test('applyDisambiguation preserves genuine attack matches', () => {
  const comment = '哈哈哈就这？你行你上啊傻逼';
  const matches = [
    { term: '哈哈哈', family: 'attack', weight: 1 },
    { term: '就这', family: 'attack', weight: 1 },
  ];
  const filtered = applyDisambiguation(comment, matches);
  assert.strictEqual(filtered.length, 2); // both should survive
});
```

## Step 5: Run full validation — 5 min

```bash
# 1. All unit tests
node --test server/services/disambiguator.test.js
node --test server/services/contextClassifier.test.js

# 2. Expanded eval
node server/scripts/evalPolysemy.js

# 3. Full JS test suite
npm test

# Expected:
#   - eval: 72 test cases (48 original + 24 new), correct ≥ 90%
#   - all existing tests pass
#   - integration smoke tests pass
```

## Success Criteria

| Metric | Before | Target |
|---|---|---|
| Terms covered by eval | 16/24 (67%) | 24/24 (100%) |
| Total eval cases | 48 | ≥72 |
| Eval correct rate | 83.3% | ≥88% |
| `applyDisambiguation` wired into commentCoverage | No | Yes (feature-flagged) |
| Scenario bias wired into disambiguation | No | Yes (`contextAwareDisambiguate`) |
| Integration smoke tests | 0 | ≥4 |
| All existing tests | Pass | Pass |

## Files to Modify

- `server/scripts/evalPolysemy.js` — add 36 test cases (24 new terms + 12 edge cases)
- `server/services/commentCoverage.js` — import and call `applyDisambiguation` after keyword matching, feature-flagged
- `server/services/disambiguator.js` — add `contextAwareDisambiguate()` wrapper
- `server/services/disambiguator.test.js` — add integration smoke tests + snapshot tests
- `server/services/contextClassifier.test.js` — verify new patterns if classifier was modified
