# Person-Level Stability (Split-Half / Test-Retest) Report

> Generated 2026-07-01 · N = 86 users (≥20 comments each) · 14 skipped for <20 comments
> Method: temporal split-half — each user's comments sorted by time, divided into
> first/second half, each half re-scored independently via the production
> `headlessScorer`, then the two `trollIndex` vectors correlated across users.

## Result

| Lexicon | Pearson r | 95% CI | Spearman ρ |
|---|---|---|---|
| default (base) | 0.049 | [-0.165, 0.258] | 0.030 |
| **full (5711 terms, 6 families)** | **0.055** | **[-0.158, 0.264]** | **0.044** |

Both CIs span zero. There is **no correlation** between a user's score on their
first comment-half and their second half.

## Interpretation

The per-user `trollIndex` composite is **not a stable person-level signal**. It
behaves as a snapshot of whichever comments happened to be sampled, not as a
property of the user. This empirically confirms the validity review's "NO" half:
describing a *person* from this composite is unsupported — not just in theory,
but by measurement.

This is distinct from, and does not contradict, the comment-level classifier
being κ-validated for *labeling a comment*. The instability lives in the
**aggregation step** (many comments → one number), which is exactly the
unvalidated link the review named as the weakest.

## Caveats

1. **Temporal split**: a genuinely changing user would lower r. But r ≈ 0.05
   across 86 users is sampling noise, not real change at scale.
2. **Half size ~24 comments** (avg 48/user). More comments per user could raise
   r, but the product operates on the samples it actually collects.
3. **Lexicon-invariant**: default vs full lexicon barely moves r (0.049 → 0.055),
   so the finding is not an artifact of dictionary choice.

## Implication for the product

- The UI disclaimer (`src/main.jsx:1390` — "评分不是人格诊断，只表示在给定评论样本中的论辩行为风险")
  is **necessary and now evidence-backed**. The score is a sample snapshot, full stop.
- The ≥10-comment gate (`src/main.jsx:1404`) prevents the worst overclaim but
  does **not** guarantee stability — even ≥10 leaves r near zero. Consider it a
  floor on overclaim, not a validity threshold.

## Reproduce

```bash
node server/scripts/runRandomSamplingEval.js --step 1   # sample (done)
node server/scripts/runRandomSamplingEval.js --step 2   # extract (done)
node server/scripts/runRandomSamplingEval.js --step 3   # score (done)
node server/scripts/splitHalfReliability.js --full-lexicon
```
