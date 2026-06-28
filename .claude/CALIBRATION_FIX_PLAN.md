# Calibration Fix Plan — Post N=100 Evaluation

> Based on `.claude/random_sampling_eval/report.md` findings (2026-06-28)
> Target: fix the 6 root problems identified in the random sampling evaluation

## Root Problems (from evaluation)

| # | Problem | Severity | Evidence |
|---|---|---|---|
| P1 | Binary threshold useless — only 1/100 users exceed 50 | Critical | P/R/F1 = 0.000 |
| P2 | Massive scale mismatch — model μ=59.5 vs annotator μ=0.38 on toxicEmotions | Critical | Spearman ρ=0.193 |
| P3 | Narrow troll_index dynamic range — 29–50 out of 0–100 | High | 21-point spread |
| P4 | Keyword over-sensitivity — 1,865 terms inflate baseline artificially | High | toxicEmotions never drops below ~30 |
| P5 | Weak per-axis correlation — model scores don't track annotator judgment | High | ρ = 0.19–0.33 across all 4 axes |
| P6 | No context calibration — meme/quote filter insufficient | Medium | Known from `isMemeOrQuotedNonAttackText` limitations |

## Phase 1: Fix Scale Mismatch (P2, P3) — Score Recalibration

### Step 1.1: Learn per-axis calibration curves from annotation data

Use the 100 annotated users as a calibration set. For each axis, fit a mapping
from model raw score (0–100) → annotator expected rating (0–2).

```
Input:  100 pairs of (model_raw_score, annotator_consensus) per axis
Output: Per-axis calibration function f(s) → calibrated score in annotator space
Method: Isotonic regression or Platt scaling (logistic)
```

**Concrete implementation:**

Add `python_backend/analysis/calibration.py` function `learn_per_axis_calibration()`:
- Load all 100 `scored/{uid}.json` and `annotated/{uid}.json`
- For each axis, collect (raw_score, consensus_avg) pairs
- Fit isotonic regression (monotonic, no parametric assumptions)
- Save calibration curves to `server/data/per_axis_calibration.json`
- Apply to headlessScorer via new export `applyCalibration(axisScores)`

**Verify:** After calibration, model predicted probability should have Brier < 0.15 and ECE < 0.15 per axis.

### Step 1.2: Recalibrate troll_index from calibrated axis scores

Current troll_index formula: `Σ(axis_score × troll_weight)` where weights are hardcoded (0.28, 0.25, 0.27, 0.20).

New approach:
- Apply per-axis calibration first
- Recompute troll_index from calibrated scores
- This should expand dynamic range from 29–50 to something closer to 0–100

**Verify:** New troll_index range should span ≥40 points (vs current 21).

## Phase 2: Fix Binary Threshold (P1)

### Step 2.1: Compute optimal threshold from ROC curve

Using the calibrated scores + binary labels from the 100-user set:
- Compute full ROC curve
- Find threshold that maximizes Youden's J (sensitivity + specificity − 1)
- Or threshold that achieves target precision/recall balance

**Concrete implementation:**

Add to `server/scripts/runRandomSamplingEval.js` step 5 (or new utility):
- `findOptimalThreshold(scores, labels, criterion='youden')` → optimal cutoff
- `computeThresholdStats(scores, labels)` → P/R/F1 at multiple thresholds

**Verify:** At optimal threshold, F1 > 0.40 (up from 0.00).

### Step 2.2: Store threshold in config

Write optimal threshold to `server/data/scoring_config.json` so headlessScorer can use it.
Add `getTrollThreshold()` to headlessScorer that reads from config, falling back to 50.

## Phase 3: Reduce Keyword Noise (P4)

### Step 3.1: Per-term precision audit

Cross-reference every dictionary term's match frequency against annotator labels:
- For each term, compute: P(annotator says argumentative | term matched)
- Flag terms with precision < 0.10 (matches but annotators disagree)

**Concrete implementation:**

Add `server/scripts/auditTermPrecision.js`:
- Load all 100 scored users' `vocabularyMarks` (which terms matched)
- Load annotator consensus per user
- Per term: precision = #argumentative_users_with_term / #users_with_term
- Output: `server/data/term_precision_audit.json` with low-precision terms flagged

### Step 3.2: Prune or downweight low-precision terms

Options (decide based on audit results):
- **Soft**: Downweight low-precision terms by precision factor (term_weight × precision)
- **Hard**: Remove terms with precision < 0.05 and < 3 occurrences
- **Hybrid**: Remove terms with precision = 0.00, downweight 0.01–0.10

**Verify:** After pruning, baseline toxicEmotions score for benign users should drop from ~30 to < 20.

## Phase 4: Improve Context Handling (P6)

### Step 4.1: Audit isMemeOrQuotedNonAttackText false negatives

Sample 50 comments where the model flagged high risk but annotators rated 0. Check if:
- The comment is a meme/quote that `isMemeOrQuotedNonAttackText` missed
- The comment uses aggressive language in a non-aggressive context (e.g., self-deprecation)
- The comment is sarcastic/ironic in a way that changes meaning

**Concrete implementation:**

Add `server/scripts/auditContextMismatches.js`:
- Load all 100 scored + annotated users
- Find comments where `findLexiconMarks` returned matches but annotator rated axis = 0
- Sample 50 and categorize the mismatch reason
- Output: `server/data/context_mismatch_audit.json`

### Step 4.2: Extend isMemeOrQuotedNonAttackText with discovered patterns

Add patterns found in Step 4.1 to `src/languageUnderstanding.js`:
- New quote patterns
- New meme patterns
- Self-deprecation markers
- Sarcasm/irony indicators

**Verify:** Re-run scoring on the 100 users. Number of "high lexicon but annotator=0" mismatches should decrease ≥20%.

## Phase 5: Learn Better Weights (P5)

### Step 5.1: Train axis weights from annotation data

Current: semantic × 0.5 + lexicon × 0.5 (uniform blend). Replace with learned weights.

**Concrete implementation:**

Add to `python_backend/analysis/calibration.py`:
- `learn_axis_weights(scored_dir, annotated_dir)` → per-axis optimal blend ratio
- For each axis, grid-search α ∈ [0, 1] where score = α × semantic + (1−α) × lexicon
- Pick α that maximizes Spearman ρ against annotator consensus
- Or use linear regression: annotator_score ~ β₁×semantic + β₂×lexicon + β₃×term_count

**Verify:** Per-axis Spearman ρ should increase from 0.19–0.33 to ≥ 0.40.

### Step 5.2: Update headlessScorer with learned weights

Modify `server/services/headlessScorer.js`:
- Read weights from `server/data/scoring_config.json`
- Apply per-axis blend ratios instead of uniform 0.5/0.5
- Keep uniform as fallback default

## Phase 6: Re-validate

### Step 6.1: Re-score all 100 users with calibrated pipeline

Run the updated pipeline on the same 100 users:
- Apply per-axis calibration (Phase 1)
- Apply term downweighting (Phase 3)
- Apply improved context filter (Phase 4)
- Apply learned blend weights (Phase 5)
- Use optimal threshold (Phase 2)

### Step 6.2: Compare before/after metrics

| Metric | Before | Target After |
|---|---|---|
| AUC-ROC | 0.538 | ≥ 0.65 |
| F1 (optimal threshold) | 0.000 | ≥ 0.40 |
| Per-axis Brier (worst) | 0.274 | < 0.15 |
| Per-axis ECE (worst) | 0.450 | < 0.20 |
| Troll index range | 29–50 | ≥ 40-point spread |
| Per-axis ρ (best) | 0.334 | ≥ 0.50 |

### Step 6.3: Hold-out validation

If improvements confirmed on the 100-user calibration set:
- Sample 30 NEW users (not in the 100)
- Score + annotate + compare
- This guards against overfitting to the calibration set

## Implementation Order

```
Phase 1 (scale) → Phase 2 (threshold) → Phase 3 (noise) → Phase 4 (context) → Phase 5 (weights) → Phase 6 (re-validate)
```

Phases 1-2 are highest priority — they fix the critical P1/P2 problems with minimal risk.
Phases 3-5 improve the underlying signal quality.
Phase 6 validates everything together and guards against overfitting.

## Files Modified

| File | Change |
|---|---|
| `python_backend/analysis/calibration.py` | Add `learn_per_axis_calibration()`, `learn_axis_weights()` |
| `server/services/headlessScorer.js` | Add `applyCalibration()`, `getTrollThreshold()`, learned blend weights |
| `server/data/scoring_config.json` | NEW — calibration curves, optimal threshold, blend weights |
| `server/scripts/auditTermPrecision.js` | NEW — per-term precision audit |
| `server/scripts/auditContextMismatches.js` | NEW — context filter false-negative audit |
| `src/languageUnderstanding.js` | Extend `isMemeOrQuotedNonAttackText` with discovered patterns |
| `server/scripts/runRandomSamplingEval.js` | Add `findOptimalThreshold()`, Phase 6 re-validation mode |

## Files NOT Modified

| File | Reason |
|---|---|
| `server/data/deepseekKeywordDictionary.entries/` | Only read for audit; pruning is a separate follow-up |
| `src/main.jsx` | Frontend reads re-exported calibrated functions from headlessScorer |

## Risk: Overfitting to DeepSeek

The calibration data is DeepSeek annotator consensus, not human labels. If we maximize
agreement with DeepSeek, we may drift from human judgment.

Mitigations:
1. Hold-out validation (Phase 6.3) — 30 new users
2. Per-term audit (Phase 3) uses precision metrics, not direct optimization
3. Calibration curves are monotonic — they rescale but don't reorder
4. Learned weights are grid-searched on Spearman ρ, not overfit with complex models
5. Document that calibration targets IRR (DeepSeek model ↔ DeepSeek annotator), not human validity
