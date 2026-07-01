# Validity Summary — N=100 Random-Sampling Eval + Split-Half Stability

> Generated 2026-07-01. First end-to-end measured validity evidence for the
> per-user `trollIndex`. Refines the autoresearch/reason verdict (which was
> conditional on exactly these numbers being computed).

## 1. Discrimination (user-level · eval steps 4–6)

| Metric | Value | Reading |
|---|---|---|
| AUC-ROC | **0.659** | Bootstrap 95% CI **[0.549, 0.772]** — above random (CI excludes 0.5), moderate |
| Best F1 (threshold sweep) | **0.589 @ threshold 4** | P=0.44, R=0.88; precision tops out 0.48 ≈ 0.34 base rate |
| P/R/F1 @ default threshold 50 | **0 / 0 / 0** | trollIndex never reaches 50 — threshold is broken |
| toxicEmotions ECE | 0.416 | badly miscalibrated |
| missingIntelligibility ECE | 0.405 | badly miscalibrated |
| otherReasons ECE | 0.000 | trivially (no positives predicted) |

Labels: **34% annotator-positive** (66% all-zero consensus) — valid class balance, not degenerate. The 17 parse warnings during annotation did not collapse the label set.

**Verdict's own gate was AUC ≥ 0.75.** Point estimate (0.659) is below it; only the CI upper bound (0.772) brushes it. So discrimination is real but **moderate, not strong**.

## 2. Stability (person-level · split-half)

| Lexicon | Pearson r | 95% CI | Spearman ρ |
|---|---|---|---|
| default | 0.049 | [-0.165, 0.258] | 0.030 |
| full (5711 terms) | 0.055 | [-0.158, 0.264] | 0.044 |

Both CIs span zero. The composite is **not stable** across a user's two comment-halves.

## 3. Scale / band mismatch — found and fixed (2026-07-01)

- `getRiskBand` previously used thresholds **45 / 70**, but measured `trollIndex`
  for 100 real users spans **[1, 10]** (mean 5.6) — so every user landed in
  `'低频命中型'`; the upper bands were unreachable (zero information).
- `headlessScorer.getTrollIndex` and `main.jsx.getTrollIndex` are structurally
  identical (`round(Σ normalizeForRisk(score)·weight)`), so it was a live UI bug.
- **Fix**: thresholds recalibrated to **5 / 8** (empirical tertile cuts on the
  N=100 distribution, landing on its natural clusters at {1–2}/{5–6}/{8–10}).
  Post-fix cross-tab vs annotator labels:

  | band | n | annot-pos | pos-rate |
  |---|---|---|---|
  | 高频命中型 (≥8) | 38 | 17 | 45% |
  | 混合模式 (5–7) | 30 | 13 | 43% |
  | 低频命中型 (<5) | 32 | 4 | **13%** |

  Low band now cleanly separates (13% vs 43–45%). Mid vs high stay
  indistinguishable — the AUC 0.66 ceiling, not a defect.

## Refined verdict (evidence-backed)

The original review said: *comment-level = YES effective enough; person-level = NO.* Measurement refines it:

- **Screening ranker** (who's more vs less likely): weakly useful — AUC 0.66, CI excludes random. But **below its own 0.75 gate**.
- **Classifier** (is this user a troll): poor — best F1 0.59, precision ≈ base rate, default threshold broken.
- **Personality / trait descriptor**: unsupported — r ≈ 0.05 unstable, and the displayed band is non-discriminating (always 'low').
- **Calibration**: poor on 2 of 4 axes (toxicEmotions, missingIntelligibility).

## Recommended next actions (ranked)

1. ~~Recalibrate `getRiskBand`~~ **DONE (2026-07-01)** — thresholds now 5/8; see §3.
2. **Retune the binary threshold** (50 → ~4) if any binary decision is exposed.
3. **Reframe claims** in README/UI copy: "weak screening ranker," never "classifier" or "trait."

## Artifacts

- `metrics.json` — full metric set + bootstrap CIs
- `report.md` — auto-generated eval report (step 6)
- `stability_report.md` — split-half detail
- `scored/100`, `annotated/100` — per-user raw data

## Reproduce

```bash
node server/scripts/runRandomSamplingEval.js --step 1   # sample (from cached AICU DB)
node server/scripts/runRandomSamplingEval.js --step 2   # extract
node server/scripts/runRandomSamplingEval.js --step 3   # score (local)
# step 4 needs DEEPSEEK_API_KEY (≈300 paid calls):
powershell -NoProfile -Command ". ./set-deepseek-env.ps1; node server/scripts/runRandomSamplingEval.js --step 4"
node server/scripts/runRandomSamplingEval.js --step 5   # metrics
node server/scripts/runRandomSamplingEval.js --step 6   # report
node server/scripts/splitHalfReliability.js --full-lexicon   # stability
```
