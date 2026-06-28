# Chinese Term Ambiguity Evaluation — DeepSeek Annotation Pipeline

> 2026-06-28. Evaluates whether the DeepSeek-powered keyword dictionary + annotation
> pipeline handles Chinese multi-meaning terms across different contexts.

## Verdict: NOT HANDLED

The current pipeline has **no context-disambiguation mechanism**. Keyword matching
is purely substring-based, the `meaning` field is unused during matching, and
DeepSeek API annotation is the sole (expensive, inconsistent) disambiguator.

## Evidence

### 1. Substring-only matching — no NLP, no context window

`python_backend/analysis/calibration.py:206` (`_extract_features`):
```python
if term in text_lower:
    family_hits[family] += 1
```

This matches "不是" equally in:
- "不是......打九克的都明说是卧底了" (argumentative opener) — **true positive**
- "这个不是红色的吗" (simple negation) — **false positive**
- "是不是要更新了" (yes/no question) — **false positive**

The same term in 3 different syntactic/semantic roles gets the same +1 hit.

### 2. The `meaning` field is unused during matching

Every dictionary entry has a `meaning` field (e.g., `"不是": "直接否定或反驳对方观点，表示不赞同"`),
but neither `calibration.py:_extract_features()` nor `extractStratifiedCandidates.js`
nor `languageUnderstanding.js` ever reads it during classification. It serves only as
documentation for human reviewers.

### 3. High-ambiguity terms dominate the dictionary

| Term | Family | Dictionary Meaning | Neutral Usage | Ambiguity Risk |
|------|--------|-------------------|---------------|----------------|
| 不是 | attack | 直接否定或反驳 | Simple negation ("it's not") | **Very High** |
| 没有 | absolutes | 全称否定 | "don't have" / "didn't" | **Very High** |
| 一定 | absolutes | 绝对化断言 | "must" / "certainly" (neutral) | **Very High** |
| 肯定 | absolutes | 绝对化断言 | "affirm" / "surely" | **Very High** |
| 一句话 | absolutes | 强调结论 | "in short" transition | **High** |
| 就是 | absolutes | 全称肯定 | Filler word "exactly" | **Very High** |
| 为什么 | attack | 质问 | Genuine curiosity | **High** |
| 哈哈哈 | attack | 讽刺嘲笑 | Genuine laughter (Bilibili norm) | **Very High** |
| 笑死了 | attack | 讽刺 | "LOL that's hilarious" | **Very High** |
| 懂的都懂 | evasion | 拒绝解释 | Community bonding/shorthand | **High** |
| 我觉得 | attack | 主观断言 | Common opinion framing | **High** |
| 全都是 | absolutes | 绝对化表述 | "All of them are..." (neutral) | **High** |
| 这就是 | absolutes | 绝对化断言 | "This is..." (filler) | **High** |

At least **15-20 high-frequency terms** (out of ~300 unique terms across all families)
are highly ambiguous. These terms account for the majority of keyword matches in
real Bilibili comments.

### 4. Evidence from stratified annotation outcome

The 182 stratified candidates produced:
- toxicEmotions A1+ = 39/182 (21%) — 79% of keyword-matched comments are NOT toxic
- missingIntelligibility A1+ = 4/182 (2%) — 98% of keyword-matched absolutes comments are neutral
- otherReasons A1+ = 8/182 (4%) — 96% false positive rate

This confirms that keyword presence ≠ argumentative behavior on Bilibili. The
overwhelming majority of matched comments use the terms in neutral contexts.

### 5. No disambiguation anywhere in the pipeline

The full call chain:
```
Comment text
  → keyword substring match (binary: contains/doesn't-contain)
  → extractStratifiedCandidates.js (sort by distinct term count)
  → annotateLabelsWithDeepSeek.js (API call per comment, ~$0.001/comment)
  → validation_metrics.py (κ computation)
  → calibration.py (logistic regression on keyword density)
  → main.jsx (radar chart scoring)
```

There is NO step that:
- Distinguishes "不是" as negation from "不是" as argumentative opener
- Detects that "笑死了" followed by "好活" is appreciation, not mockery
- Recognizes that "我觉得" + factual claim is different from "我觉得" + personal attack
- Uses the `meaning` field to check whether the comment's context matches the toxic interpretation

### 6. DeepSeek IS the disambiguator — but it's the bottleneck

The annotation script sends raw comment text to DeepSeek with a behavioral prompt.
DeepSeek reads the full comment and applies linguistic context. This DOES work
(DeepSeek correctly identifies that most keyword-matched comments are neutral),
but it's:

- **Expensive**: one API call per comment
- **Slow**: sequential processing with rate limits
- **Inconsistent**: κ = 0.24 between prompt variants
- **Non-deterministic**: same comment, same prompt can get different results

## Root Cause Summary

The keyword dictionary was built to detect POTENTIAL argumentative behavior by
identifying linguistic patterns that COULD signal toxicity. But it was never
equipped with a lightweight context-disambiguation step. Every term is treated
as equally indicative regardless of surrounding context.

This creates a **precision bottleneck**: the dictionary has high recall (catches
most argumentative comments) but very low precision (~5-21% depending on axis).
The entire annotation pipeline exists to compensate for this precision gap, but
the compensation is expensive and unreliable.

## Fix Plan — 4 Steps

### Step 1: Add Context-Disambiguation Rules (`server/data/disambiguation_rules.json`)

Create a lightweight rule engine that runs BEFORE keyword matching. Each rule
checks whether the matched term's surrounding context supports the argumentative
interpretation.

```json
{
  "term": "不是",
  "family": "attack",
  "rules": [
    {
      "type": "prefix_negation",
      "description": "不是 as simple negation: not followed by argumentative content",
      "pattern": "不是[^，。！？…]{0,6}[的了吧吗呢啊]",
      "action": "suppress",
      "confidence": 0.8
    },
    {
      "type": "yes_no_question",
      "description": "是不是/不是...吗 as yes/no question, not argument",
      "pattern": "是不是|不是[^，。！？…]{1,10}吗",
      "action": "suppress",
      "confidence": 0.85
    },
    {
      "type": "argumentative_opener",
      "description": "不是 as sentence-initial rebuttal with following assertion",
      "pattern": "^不是[，, ]{0,2}[^，。！？…]{5,}",
      "action": "confirm",
      "confidence": 0.7
    }
  ]
}
```

Rules to create for the top-20 most ambiguous terms:
1. 不是 — negation vs. argumentative opener
2. 没有 — simple negation of existence vs. absolute denial
3. 一定 — neutral certainty vs. dogmatic assertion
4. 肯定 — affirmation vs. absolute assertion
5. 笑死了/哈哈哈 — genuine laughter vs. mockery
6. 懂的都懂 — community shorthand vs. evasion
7. 我觉得 — opinion framing vs. subjective assertion
8. 全都是/都是 — simple quantification vs. absolute generalization
9. 一句话 — transition phrase vs. conclusive assertion
10. 为什么 — genuine question vs. rhetorical attack

### Step 2: Implement Disambiguation Engine (`server/services/disambiguator.js`)

A lightweight JS service that:
1. Loads disambiguation rules
2. For each keyword match, checks surrounding context (±10 chars, or full sentence)
3. Returns: `{ term, match, action: "confirm" | "suppress" | "neutral", confidence }`
4. "suppress" = don't count this match toward keyword density
5. "confirm" = count with boosted weight
6. "neutral" = count with default weight

```js
// API
import { disambiguate } from '../services/disambiguator.js';
const result = disambiguate(commentText, keywordMatches);
// → [{ term: "不是", action: "suppress", reason: "yes_no_question", confidence: 0.85 }, ...]
```

### Step 3: Integrate into Feature Extraction

Modify `calibration.py:_extract_features()` and `extractStratifiedCandidates.js` to:
1. Call disambiguator after keyword matching
2. Only count "confirm" and "neutral" matches
3. Skip "suppress" matches entirely
4. Log suppression rate per term for monitoring

Expected effect: ~60-80% reduction in false positive keyword matches, concentrating
the annotation pipeline on genuinely argumentative comments.

### Step 4: Measure Impact

Re-run the stratified annotation pipeline with disambiguation enabled:
```bash
# 1. Re-extract candidates with disambiguation
node server/scripts/extractStratifiedCandidates.js --disambiguate

# 2. Re-run A1+A2 annotation on disambiguated candidates
node server/scripts/annotateLabelsWithDeepSeek.js --annotator A1 ...

# 3. Compute κ on disambiguated set
python -m python_backend.analysis.validation_metrics --input ... --output-kappa ...
```

Target: positive annotation rate increase from ~10% to ~40-60%, κ improvement from
0.24 to 0.40-0.55 (moderate-to-substantial).

## Expected Outcomes

| Metric | Current (No Disambiguation) | Target (With Disambiguation) |
|--------|---------------------------|------------------------------|
| Keyword match precision | ~5-21% | ~40-60% |
| TE+ annotation rate | 21% | 40-55% |
| MI+ annotation rate | 2% | 10-20% |
| OR+ annotation rate | 4% | 10-20% |
| Pairwise κ (A1-A2) | 0.24 | 0.40-0.55 |
| Annotation cost per 100 candidates | ~$0.10 | ~$0.10 (same) |
| False positive keyword hits | ~80-95% | ~20-40% |

## Files Changed

| File | Action |
|------|--------|
| `server/data/disambiguation_rules.json` | **NEW** — per-term context-disambiguation rules |
| `server/services/disambiguator.js` | **NEW** — lightweight disambiguation engine |
| `python_backend/analysis/calibration.py:193-227` | **MODIFY** — integrate disambiguation into `_extract_features` |
| `server/scripts/extractStratifiedCandidates.js` | **MODIFY** — add `--disambiguate` flag |
| `python_backend/tests/test_disambiguator.py` | **NEW** — disambiguation rule tests |

## Relationship to κ Gate Fix

This fix addresses a **prerequisite** problem for the κ gate fix in
`.claude/KAPPA_GATE_FIX_PLAN.md`. The argumentativeness pre-filter (Step 1 of
that plan) is essentially a heuristic approximation of what proper context
disambiguation would do. Building the disambiguation engine FIRST would make
the κ gate fix's pre-filter more effective and potentially eliminate the need
for 3-annotator consensus.

**Recommendation**: Execute this plan before or alongside the κ gate fix.
The disambiguation rules directly increase annotation precision, which is the
root cause of low κ values.

## Estimated Time: 45-60 min

| Step | Time |
|------|------|
| 1. Create disambiguation rules (top 20 terms) | 20 min |
| 2. Implement disambiguation engine | 15 min |
| 3. Integrate into feature extraction | 10 min |
| 4. Measure impact (re-extract + re-annotate 50 samples) | 10-15 min |
