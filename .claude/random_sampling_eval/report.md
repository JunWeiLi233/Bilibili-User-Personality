# Random Sampling Evaluation Report

> Generated 2026-06-28T15:36:53.090Z
> N = 100 Bilibili users, randomly sampled from UID range 1–700M

## Executive Summary

This evaluation measures how well the personality analysis model's **troll index**
and **4-axis Ziegenbein scores** agree with a careful DeepSeek A1/A2/A3 annotator
consensus read of each user's full comment history.

**Key finding:** The model shows limited discrimination between argumentative and non-argumentative users.

## Classification Performance

| Metric | Value | Notes |
|---|---|---|
| AUC-ROC | 0.538 | Discrimination (0.5 = random, 1.0 = perfect) |
| Precision | 0.000 | PPV at troll_index ≥ 50 |
| Recall | 0.000 | Sensitivity at troll_index ≥ 50 |
| F1 Score | 0.000 | Harmonic mean of precision and recall |
| N (paired) | 100 | Users with both scores and annotations |

### Bootstrap 95% Confidence Intervals (N=1000 resamples)

| Metric | Lower CI | Median | Upper CI |
|---|---|---|---|
| AUC-ROC | 0.420 | 0.535 | 0.656 |
| F1 | 0.000 | 0.000 | 0.000 |

## Per-Axis Calibration

| Axis | Brier Score | ECE | N |
|---|---|---|---|
| toxicEmotions | 0.274 | 0.405 | 100 |
| missingCommitment | 0.072 | 0.249 | 100 |
| missingIntelligibility | 0.227 | 0.450 | 100 |
| otherReasons | 0.037 | 0.037 | 100 |

- **Brier score**: Mean squared error between predicted probability and observed outcome. Lower is better; < 0.25 is better than a constant predictor.
- **ECE (Expected Calibration Error)**: Weighted average of |accuracy − confidence| across 10 bins. Lower is better; < 0.15 is well-calibrated.

## Detailed Findings

### Sample Composition

- **100 users** randomly sampled from 5,865 cached AICU users
- **Average 50 comments/user** (range: 10–80)
- **Source**: aicu-user-database.json (AICU API now behind SafeLine WAF — new scrapes blocked)
- **DeepSeek A1/A2/A3 consensus**: 300 API calls (deepseek-v4-flash, ~$0.50 total)

### Annotation Distribution (DeepSeek Consensus)

| Dimension | Positive (≥1) | Rate |
|---|---|---|
| toxicEmotions | 30 | 30% |
| missingCommitment | 4 | 4% |
| missingIntelligibility | 8 | 8% |
| otherReasons | 13 | 13% |
| **Any argumentative** | **37** | **37%** |

37% of randomly sampled Bilibili users show at least one argumentative-behavior dimension — a reasonable base rate for a discussion platform.

### Troll Index Distribution

| Stat | Value |
|---|---|
| Range | 29–50 |
| Median | 38 |
| % ≥ 50 (default threshold) | 1% |
| % ≥ 40 | 44% |

The troll_index has **very narrow dynamic range** (29–50 out of 0–100). Only 1 user exceeds the default threshold of 50. The model is massively under-utilizing its score range, making the binary threshold effectively useless.

### Per-Axis Correlation (Spearman ρ, model score vs. annotator consensus)

| Axis | ρ | Model μ (0–100) | Annotator μ (0–2) |
|---|---|---|---|
| toxicEmotions | 0.193 | 59.5 | 0.38 |
| missingCommitment | 0.296 | 26.9 | 0.04 |
| missingIntelligibility | 0.282 | 49.5 | 0.09 |
| otherReasons | 0.334 | 10.7 | 0.14 |

All correlations are **weak positive** (0.19–0.33). The model has some signal but far below actionable reliability. The most striking finding: the model rates toxicEmotions at mean 59.5/100 while annotators see only 0.38/2.0 — a **massive scale mismatch**. The model's lexicon-based approach is dramatically over-counting risk markers relative to holistic human judgment.

### Scale Mismatch Analysis

The model's 0–100 scoring operates in a fundamentally different space from the annotator's 0–2 rating. The model's high baseline (toxicEmotions never drops below ~30) means it sees "risk" everywhere, while annotators see most comments as benign. Two possible explanations:

1. **Lexicon over-sensitivity**: The keyword dictionary flags many terms that, in context, are not argumentative (memes, self-directed humor, quoted speech).
2. **Annotator under-sensitivity**: DeepSeek annotators, reading full user histories, apply a higher bar for what constitutes "argumentative behavior" than per-comment keyword matching.

The truth is likely a mix of both. Neither is "wrong" — they measure different things. The model measures **surface-level lexical risk markers**; the annotator measures **holistic argumentative intent**. These are correlated but distinct constructs.

## Interpretation

### What this evaluation measures

The model produces a **troll_index (0–100)** and **4 Ziegenbein axis scores**
from a user's Bilibili comments. This evaluation checks whether:

1. **The troll_index discriminates** between users the annotator consensus marks as argumentative vs. non-argumentative (AUC-ROC).
2. **The per-axis scores are calibrated** — when the model says "toxicEmotions = 80", does that user actually show high toxic emotions by annotator judgment? (Brier, ECE).
3. **The default threshold of 50** makes reasonable binary decisions (precision/recall/F1).

### What this evaluation does NOT measure

1. **External human validity**: DeepSeek is both the scoring model AND the annotator (with different prompt personas). This measures **inter-rater reliability** (does the fast keyword+density model agree with a careful holistic DeepSeek read?), not accuracy against human judgment.
2. **Causal validity**: A high troll_index does not mean the user IS a troll — it means the user's comments contain argumentative-behavior markers.
3. **Generalizability**: 100 users is a small sample. Results may not generalize to the full Bilibili population.

## Limitations

1. **No human ground truth**: DeepSeek annotator consensus is a proxy. Results measure IRR (model ↔ careful DeepSeek read), not external validity.
2. **Sampling bias**: Users with <10 comments excluded. Active commenters may not represent the general Bilibili population.
3. **Language scope**: Chinese-only. Model may not generalize to other languages.
4. **Temporal drift**: Comments scraped at a single point in time. User behavior and platform norms change.
5. **Annotation cost**: DeepSeek annotation of 100 users' full comment sets consumed significant API tokens.

## Recommendations

### Immediate Actions

1. **Lower the binary threshold from 50 to 35–38** (the median). At 50, recall is 0%. At 35, ~70% of users would be flagged — too many false positives. A receiver operating curve should be computed to find the optimal cutoff.

2. **Recalibrate the per-axis score ranges.** toxicEmotions has a 59.5 mean on a 0–100 scale — it's wasting half the range. Apply per-axis scaling so the population mean sits at ~30 with SD ~20, creating usable dynamic range.

3. **Audit the keyword dictionary for over-sensitivity.** With 1,865 terms, many common discourse markers may be inflating risk scores. Cross-reference dictionary terms against annotator-flagged comments to identify low-precision terms.

### Medium-Term Improvements

4. **Add a "context calibration" layer.** The model's lexicon-based approach counts keyword hits without considering whether the comment is a meme, quote, or self-reference. The `isMemeOrQuotedNonAttackText` filter exists but may need strengthening.

5. **Train per-axis regression weights on the annotation data.** The current logistic regression attempt (2026-06-28) failed due to insufficient positive examples. With 30 toxicEmotions positives in this sample, a simple linear model could learn better weights than the current uniform blend.

6. **Expand the annotation dataset.** 100 users is minimal for reliable calibration. Target 300+ users with 3-annotator consensus for production-grade weights.

### Validation Strategy

7. **Treat this as a baseline, not a verdict.** This is the project's first whole-user validation. AUC=0.54 and weak per-axis correlations are typical for a first iteration. The key question is whether targeted improvements (recommendations 1–6) move the needle on a follow-up evaluation.

### What NOT to Do

8. **Don't over-tune to DeepSeek consensus.** DeepSeek is both the scorer and annotator — tuning to maximize agreement risks overfitting to one model's subjective judgment. The goal is to build a model that agrees with *human* annotators. DeepSeek consensus is a useful development proxy but not the final target.

---
*Report auto-generated by runRandomSamplingEval.js*
