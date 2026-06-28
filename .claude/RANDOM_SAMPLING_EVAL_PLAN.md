# Random Sampling Evaluation Plan

> Generated 2026-06-28. Purpose: design a random Bilibili user sampling pipeline to evaluate the personality analysis model's accuracy.

## What "Accuracy" Means for This Model

The model produces a **troll index (0–100)** and **4 Ziegenbein axis scores** from a user's Bilibili comments. Currently validated:

| Check | Status | Method |
|---|---|---|
| Inter-annotator agreement | ✅ k=0.80 (substantial) | 300 comments, 3 DeepSeek personas |
| Item-total correlation | ✅ r=0.55–0.91 per axis | 100-user keyword density corpus |
| Keyword coverage | ✅ ~89% of dictionary terms | Coverage audit loop |
| **Whole-user accuracy vs ground truth** | ❌ NOT VALIDATED | — |

The gap: nobody has checked whether the model's troll index actually separates argumentative from non-argumentative **users** (as opposed to individual comments).

## Methodology

```
Random UID sample (N=100)
       │
       ▼
Scrape comments + danmaku (AICU API, 10 pages each)
       │
       ├──► Headless scoring pipeline ──► troll_index + axis scores
       │
       └──► DeepSeek A1/A2/A3 annotation ──► consensus ground truth
                    │
                    ▼
              Compare: AUC-ROC, Brier, F1, calibration curves
                    │
                    ▼
              Evaluation report
```

### Sampling Strategy

- **Population**: Bilibili users with ≥10 public comments (filtered during validation)
- **UID range**: 1–700,000,000 (covers all registered users)
- **N**: 100 users (80% power to detect AUC ≥ 0.65 vs null 0.50)
- **Resampling**: Replace UIDs with <10 comments until N=100 validated

### Ground Truth

Since no human-labeled whole-user profiles exist, we use **DeepSeek annotator consensus** as a proxy:

1. **A1 (balanced)**: Rates each user's full comment set on 4 axes (0–2)
2. **A2 (strict)**: Same, but requires explicit textual evidence
3. **A3 (consensus)**: Sees A1+A2 ratings, resolves disagreements
4. **Binary label**: Per-axis consensus avg ≥ 1.0 → "argumentative" on that axis

**Circularity risk**: DeepSeek powers both the scoring model AND the annotator. Mitigations:
- Annotation uses different prompt personas than scoring
- Scoring uses regex rules + keyword density; annotation uses holistic LLM judgment
- Treat results as **IRR validation** (does the model agree with a careful DeepSeek read?) rather than **external accuracy** (does it match human judgment?)

### Metrics

| Metric | What It Tells Us | Target |
|---|---|---|
| AUC-ROC | How well troll_index separates argumentative from non-argumentative users | > 0.65 |
| Precision/Recall/F1 (threshold=50) | Binary classification quality at default cutoff | F1 > 0.60 |
| Per-axis Brier score | Calibration: do predicted scores match observed rates? | < 0.25 (better than constant predictor) |
| Per-axis ECE | Expected calibration error (binned) | < 0.15 |
| Bootstrap 95% CIs | Confidence in all metrics | Finite, reasonably narrow |
| Stratified F1 by comment volume | Does the model work for both low-activity and high-activity users? | F1 within 0.10 across terciles |

### Statistical Power

- N=100, α=0.05, two-sided
- Detectable AUC (vs null=0.50): 0.65 at 80% power
- Per-axis calibration: 400 observation points (100 users × 4 axes)
- Bootstrap: N=1000 resamples for stable CIs

## Implementation

### New Files

| File | Purpose |
|---|---|
| `.claude/tasks/random_sampling_eval.json` | Task config with checkpointing (created) |
| `server/scripts/runRandomSamplingEval.js` | Orchestration script: sample → scrape → score → annotate → evaluate → report |
| `.claude/random_sampling_eval/sample_uids.json` | Validated UID list |
| `.claude/random_sampling_eval/user_data/{uid}.json` | Raw scraped comments per user |
| `.claude/random_sampling_eval/scored/{uid}.json` | Model output per user |
| `.claude/random_sampling_eval/annotated/{uid}.json` | DeepSeek consensus per user |
| `.claude/random_sampling_eval/metrics.json` | All computed metrics |
| `.claude/random_sampling_eval/report.md` | Final evaluation report |

### Existing Files Touched

| File | How |
|---|---|
| `src/main.jsx:scoreComments` | Extract scoring logic into headless module (or call via new API endpoint) |
| `server/routes/aicu.js` | Already scrapes UID comments — reuse directly |
| `server/scripts/annotateLabelsWithDeepSeek.js` | Already annotates comments — adapt for whole-user annotation |
| `python_backend/analysis/calibration.py` | Brier + ECE computation — reuse |
| `python_backend/analysis/validation_metrics.py` | Kappa + F1 + bootstrap — reuse |

### Rate Limiting & Runtime Budget

- ~1000 HTTP requests (100 users × 10 pages)
- Conservative pacing: 2s delay between requests
- Estimated runtime: ~30 minutes for scraping, ~20 minutes for annotation, ~5 minutes for scoring+evaluation
- Checkpointing: every UID, so interruption loses zero progress

## Limitations (to be documented in report)

1. **No human ground truth**: DeepSeek annotator consensus is a proxy. Results measure IRR (model ↔ careful DeepSeek read), not external validity.
2. **Sampling bias**: Users with <10 comments excluded. Active commenters may not represent the general Bilibili population.
3. **Language scope**: Chinese-only. Model may not generalize to other languages.
4. **Temporal drift**: Comments scraped at a single point in time. User behavior and platform norms change.
5. **Annotation cost**: DeepSeek annotation of 100 users' full comment sets will consume significant API tokens. Budget accordingly.
