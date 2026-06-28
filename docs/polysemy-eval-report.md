# Polysemy Disambiguation Evaluation Report

**Date**: 2026-06-28
**System**: `disambiguator.js` (24 terms, 104 regex rules) + `contextClassifier.js` (6 scenarios)

## Summary

| Metric | Value |
|---|---|
| Total test cases | 48 |
| **Correct** | **33 (68.8%)** |
| Partial (neutral instead of suppress/confirm) | 8 (16.7%) |
| Wrong (inverted action) | 7 (14.6%) |
| **OK + Partial** | **41 (85.4%)** |

## Methodology

48 hand-crafted test cases across 16 ambiguous Chinese terms. Each case presents the SAME keyword in a DIFFERENT context — one where the term carries its argumentative dictionary meaning, and one where it's being used neutrally. This is the hardest test: the system must distinguish based on surrounding words alone.

Tested terms: 不是, 没有, 一定, 笑死, 典, 急了, 哈哈哈, 觉得, 为什么, 可能, 就是, 肯定, 应该, 都是, 确实, 一句话

## Per-Term Accuracy

| Term | Accuracy | Notes |
|---|---|---|
| 急了 | 3/3 (100%) | Self-referential, direct accusation, observational — all correct |
| 哈哈哈 | 3/3 (100%) | Standalone laughter, mockery, appreciation — all correct |
| 就是 | 2/2 (100%) | Clarification vs absolute equation — both correct |
| 肯定 | 2/2 (100%) | Casual affirmation vs unqualified assertion — both correct |
| 应该 | 2/2 (100%) | Hedged suggestion vs moralistic — both correct |
| 没有 | 4/5 (80%) +1 partial | Comparative "没有...那么" missed (no rule matched) |
| 一定 | 4/5 (80%) | "不一定" misclassified — rule ordering bug |
| 笑死 | 3/4 (75%) +1 partial | Targeted mockery missed (no rule matched for "笑死，你...") |
| 为什么 | 2/3 (67%) +1 partial | Genuine question missed (no rule matched) |
| 典 | 2/3 (67%) +1 partial | "典中典" mockery missed (no rule matched) |
| 确实 | 1/2 (50%) +1 partial | Sarcastic "确实 + 典/绷" missed (no rule matched) |
| 可能 | 1/2 (50%) | Disguised absolute missed — rule ordering bug |
| 不是 | 2/5 (40%) +1 partial | Worst performer — rule ordering + pattern problems |
| 一句话 | 1/2 (50%) | Conclusive opener missed — rule ordering bug |
| 觉得 | 1/3 (33%) +1 partial | Negative judgment missed — rule ordering bug |
| 都是 | 0/2 (0%) +1 partial | Blame attribution missed — rule ordering bug |

## Failure Analysis

### 7 Wrong (action inverted)

All 7 are **rule ordering bugs** — a broader/greedier rule fires before a more specific one:

| # | Case | Text | Expected | Got | Rule that fired | Rule that should fire |
|---|---|---|---|---|---|---|
| 1 | 不是-B | "不是他傻，是策划真的有问题" | suppress | confirm | `negation_with_personal_attack` | `not_x_but_y` |
| 2 | 不是-D | "不是傻就是蠢，你自己选一个" | confirm | suppress | `not_x_but_y` | `negation_with_personal_attack` |
| 3 | 一定-C | "不一定是坏事吧" | suppress | confirm | `dogmatic_assertion` | `negated_absolute` |
| 4 | 觉得-B | "我觉得你根本就不懂..." | confirm | suppress | `self_directed` | `negative_judgment` |
| 5 | 可能-B | "可能是策划完全没考虑过..." | confirm | suppress | `uncertainty_expression` | `absolutist_with_maybe` |
| 6 | 都是-B | "都是策划的错，这种垃圾..." | confirm | suppress | `descriptive_attribution` | `overgeneralization_blame` |
| 7 | 一句话-B | "一句话，策划根本就不配..." | confirm | suppress | `transition_phrase` | `conclusive_assertion` |

### 8 Partial (neutral, should be more decisive)

These are cases where no specific rule matched, so the system defaulted to `neutral`:

| # | Case | Term | Text | Expected | Why missed |
|---|---|---|---|---|---|
| 1 | 不是-E | 不是 | "我不是很懂这个机制" | suppress | "不是" + "不" in self-negation — no matching rule |
| 2 | 没有-C | 没有 | "我觉得这个没有那个好用" | suppress | Comparative "没有...那么" when "那么" is far — pattern window too narrow |
| 3 | 笑死-B | 笑死 | "笑死，你这理解能力..." | confirm | "笑死" at sentence start + "你" — targeted mockery rule requires contiguous "笑死你" |
| 4 | 典-B | 典 | "典中典，这种话术我见多了" | confirm | "典中典" + "话术" — mockery_label pattern requires chars between 典 and label |
| 5 | 为什么-A | 为什么 | "为什么这个技能有延迟" | suppress | "为什么" without explicit curiosity marker — genuine_question pattern doesn't cover this |
| 6 | 觉得-C | 觉得 | "我觉得这个设计不太合理" | neutral | "我觉得" + constructive criticism — borderline case, system chose suppress |
| 7 | 都是-A | 都是 | "这些都是常规操作" | suppress | "这些都是" — simple_identification should match but "这些都是" starts with "这" not "都是" alone |
| 8 | 确实-B | 确实 | "确实，典中典发言，绷不住了" | confirm | "确实" + meme terms — dismissive_confirmation pattern doesn't match standalone "确实，" |

## Scenario Classification Accuracy

The `contextClassifier.js` classified 48 test comments into 6 scenarios:

| Scenario | Cases | Representative |
|---|---|---|
| neutral_info | 20 | Factual statements, questions |
| praise | 12 | Positive reactions, encouragement |
| taunting | 9 | Mockery, sarcasm, meme usage |
| argument | 6 | Debate, evidence-based rebuttal |
| reassurance | 1 | Calming, supportive |

The scenario classifier is **too coarse** for direct disambiguation — it correctly identifies taunting for obvious mockery but misses subtle argumentative patterns. This is expected for a regex-based approach.

## Root Cause Summary

### Dominant problem: Rule ordering (7/7 wrong cases)

The disambiguator uses first-match-wins priority. When a general rule (e.g., "contains any personal pronoun") comes before a specific rule (e.g., "followed by negative judgment terms"), the general rule captures cases it shouldn't.

**Fix**: Reorder rules within each term group so more specific patterns come FIRST:
1. Negated/exception patterns (e.g., "不一定", "不是...而是")
2. High-confidence confirm patterns (specific attack formulas)
3. High-confidence suppress patterns (specific neutral formulas)
4. Broad/general patterns (catch-all defaults)

### Secondary problem: Pattern window gaps (5/8 partial cases)

Some patterns require contiguous matches or narrow character windows that miss real usage:
- "笑死，你" — comma between term and target breaks the pattern
- "没有...那么好用" — 3+ chars between 没有 and 那么 breaks comparison detection
- "典中典，这种话术" — the mockery is separated by a comma

**Fix**: Widen character windows or add intermediate-wildcard patterns for common separators (commas, pauses).

## Recommendations

### Quick wins (30 min, fixes 7 wrong → all correct)
1. **Reorder rules** in 7 term groups: 不是, 一定, 觉得, 可能, 都是, 一句话
2. Expected improvement: accuracy from 68.8% → ~83%

### Moderate effort (1 hr, fixes 5 partial → decisive)
3. **Widen pattern windows** for comparative 没有, standalone 确实, sentence-start 笑死
4. **Add missing patterns**: "不是很懂" (self-negation), "典中典 + clause"
5. Expected improvement: accuracy from 83% → ~92%

### Long-term ceiling
- Regex-based disambiguation cannot resolve genuinely ambiguous cases where intent depends on broader discourse context or tone
- Embedding-based semantic similarity (comparing comment to canonical examples of each sense) would be the next step for the remaining ~8%
- Multi-turn context (reply chains) would help for cases like "确实" where sarcasm depends on what's being replied to

## Conclusion

The regex-based disambiguator is **serviceable at 68.8% (85.4% with partial credit)**. The dominant failure mode is rule ordering, which is trivially fixable. With ~30 minutes of reordering work, accuracy would reach ~83%. The remaining errors are pattern coverage gaps that need wider matching windows or embedding-based semantic disambiguation.

The system correctly handles the most common Bilibili discourse patterns: standalone laughter vs mockery (哈哈哈, 100%), encouragement vs dogma (一定, 80%), self-deprecation vs accusation (急了, 100%), and filler vs absolute assertion (就是, 100%).
