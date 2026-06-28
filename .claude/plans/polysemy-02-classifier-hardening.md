# Plan 02: Context Classifier Hardening — Fix Scenario Mislabeling

**Status**: Not started | **Estimate**: ~45 min | **Target**: Scenario accuracy from ~60% → ≥85%

## Problem

The `contextClassifier.js` (lightweight regex scenario classifier, 6 scenarios) mislabels ~40% of test comments during the polysemy eval. This matters because the classifier is designed to provide a **scenario bias** for the disambiguator — if it labels an argumentative comment as "praise", the disambiguation confidence adjustment goes the wrong direction.

### Misclassification Examples from Eval

| Comment | Classified As | Should Be | Why Wrong |
|---|---|---|---|
| "不是傻就是蠢，你自己选一个" | argument | taunting | Personal insults, not evidence-based debate |
| "这个bug一定是程序员偷懒导致的" | neutral_info | taunting | Blame attribution with mockery tone |
| "笑死，你这理解能力也就这样了" | taunting | taunting | ✓ Correct |
| "这次更新肯定是在逼玩家氪金" | **praise** | taunting | "肯定是" matched as positive? Wrong. |
| "为什么你每次都这么菜还喜欢甩锅" | **praise** | taunting | Insult + accusation, classified as praise |
| "就是程序员垃圾，没什么好说的" | argument | taunting | Absolute negative label, not reasoned argument |
| "都是策划的错，这种垃圾活动" | **praise** | taunting | Blame + insult, classified as praise |

**Pattern**: Comments with Chinese negation/emotion words that contain character substrings matching praise patterns (e.g., "肯定" in "肯定是" matches "肯定啊" positive affirmation) get misclassified.

## Root Cause

The classifier uses regex signal matching with no negation awareness and no sentiment polarity:

1. **No negation handling**: "不是" + positive word still counts as positive
2. **Substring false positives**: "肯定是在逼玩家氪金" → "肯定" substring fires `affirmation_response` signal → praise
3. **Weak taunting signals**: The taunting lexicon is too narrow (only 11 strong patterns). Common Bilibili attack patterns like "X垃圾", "X的错", "瞎改", "甩锅" aren't covered
4. **Argument vs taunting confusion**: Evidence-based debate patterns (证据, 数据, 逻辑) and emotional attacks both score for "argument"

## Step 1: Expand taunting signal lexicon — 15 min

Add strong signals for common Bilibili attack/insult patterns:

```javascript
taunting: {
  strong: [
    // Existing
    /哈哈哈+/u, /笑死[我了]?/u, /乐死/u, /典中典/u,
    /急了急了/u, /破防了/u, /不会吧不会吧/u, /就这\?/u,
    /不会真的?有人/u, /🤣|😂|😅|😏|🙃/u,
    // NEW: Blame and accusation patterns
    /[你他她它这那].{0,4}(?:垃圾|废物|脑残|智障|sb|SB|傻逼|傻叉)/u,
    /(?:策划|官方|运营|资本|节目组).{0,4}(?:傻|蠢|笨|垃圾|恶心|离谱|脑残|不要脸)/u,
    /(?:的错|的问题|害的|搞的|干的|弄的)[!！。？…]*$/u,
    // NEW: Dismissive memes and mockery
    /[你他她]?.{0,2}(?:配吗|也配|就这|急了|绷不住了|孝了|典了)/u,
    /(?:别扯|洗地|洗白|硬洗|尬吹|无脑吹)/u,
    /(?:甩锅|背锅|扣帽子|双标|道德绑架)/u,
    // NEW: Exaggerated mockery
    /[你他她]?(?:真[有会]?意思|可真?行|挺会|好一个|好意思)/u,
    /(?:不懂|不会|不能|不行|不好|不对|错了)[!！。？…]*$/u,
  ],
  weak: [
    // Existing
    /[你您][真可]?行/u, /[真可]?牛[逼批啤]?/u,
    /赢[麻嘛]了/u, /不愧是你/u, /你说得对/u, /确实[是]?[的]?$/u,
    // NEW: Mild negative assessments
    /(?:不太行|不太对|不太合理|不太合适|不怎么样|不咋地)/u,
    /(?:差评|劝退|失望|无语|离谱|搞笑[呢吧]?)/u,
    /(?:就硬|硬要|非要|偏要).{0,4}(?:是吧|吗|么)/u,
  ],
},
```

**Verify**: Re-run eval — "肯定是在逼玩家氪金" should now classify as `taunting`, not `praise`.

## Step 2: Add negation-aware scoring — 10 min

Currently, `classifyScenario()` counts regex matches additively. A comment can simultaneously score for `praise` (because "肯定" appears) and `taunting` (because "垃圾" appears). The fix: subtract praise score when strong taunting signals are present:

```javascript
// After computing scores, apply cross-scenario suppression:
// If taunting score >= 3, suppress praise score by 50%
if (scores.taunting >= 3) {
  scores.praise = Math.floor(scores.praise * 0.5);
}
// If argument signals are from attack words (not evidence words), reduce argument score
// (This is a heuristic — argument with insults is more likely taunting)
if (scores.taunting >= 4 && scores.argument >= 2) {
  scores.argument = Math.max(0, scores.argument - 2);
}
```

**Verify**: Comments with both praise-matching substrings and strong taunting signals should classify as `taunting`.

## Step 3: Add Chinese negation pre-filter — 10 min

Before scoring, strip negation-enclosed positive words so they don't falsely boost praise/argument:

```javascript
// Pre-process: if a positive signal matches inside a negation scope, halve its weight
const NEGATION_SCOPES = [
  /不(?:是|会|能|可以|行|对|好|懂|知道|明白|理解|同意|赞成|支持)[^，。！？…]{0,8}/gu,
  /没(?:有|什么|啥|多|那么|这么)[^，。！？…]{0,8}/gu,
];
```

This is a lighter alternative to full sentiment analysis — only targeting the specific false-positive cases seen in the eval.

**Verify**: "不是他傻，是策划真的有问题" — the "不是" should suppress any positive signal from "真的" within its scope.

## Step 4: Distinguish argument from taunting — 10 min

Currently many taunting comments classify as "argument" because they contain words like "不是", "为什么", "但是" (argument weak signals). Add a tiebreaker:

```javascript
// After computing scores:
// If taunting and argument are close (within 2 points), prefer taunting
// because Bilibili discourse is more often taunting than reasoned argument
if (scores.taunting > 0 && scores.argument > 0 &&
    Math.abs(scores.taunting - scores.argument) <= 2) {
  scores.argument -= 1;  // slight bias toward taunting
}
```

**Verify**: "不是傻就是蠢" should classify as `taunting`, not `argument`.

## Step 5: Run validation — 5 min

```bash
# 1. Existing tests must pass
node --test server/services/contextClassifier.test.js

# 2. Run the full eval and spot-check scenario labels
node server/scripts/evalPolysemy.js

# 3. Expected: taunting cases increase from 9 to ~18 (of 48)
#    praise cases decrease from 12 to ~6
#    argument cases should be evidence-based debate, not insults
```

## Success Criteria

| Metric | Before | Target |
|---|---|---|
| Taunting misclassified as praise | 4+ cases | 0 cases |
| Taunting misclassified as argument | 5+ cases | ≤1 case |
| Taunting misclassified as neutral_info | 3+ cases | ≤1 case |
| Overall scenario plausibility | ~60% | ≥85% |
| ContextClassifier tests | all pass | all pass |

## Files to Modify

- `server/services/contextClassifier.js` — expand SIGNALS.taunting, add cross-scenario suppression, add negation pre-filter, add argument-vs-taunting tiebreaker
- `server/services/contextClassifier.test.js` — add test cases for new taunting patterns
