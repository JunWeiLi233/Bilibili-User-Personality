# Validity Summary — N=100 Random-Sampling Eval

> Generated 2026-07-01. First end-to-end measured validity evidence for the
> per-user `trollIndex`. **Corrected 2026-07-01:** an earlier draft claimed the
> risk bands were broken because "real trollIndex spans [1,10]." That measured
> `headlessScorer`'s *calibrated* trollIndex; the UI displays a *raw-weighted*
> trollIndex that spans [25,49]. The band claim was wrong and is retracted. The
> real findings are below.

## 0. Key finding — two different `trollIndex` values

There are **two `getTrollIndex` computations that disagree**:

| | `headlessScorer` (eval path) | UI (`src/main.jsx:527`) |
|---|---|---|
| input | `calibratedScores` (post-`applyCalibration`) | raw `score.value` |
| range on N=100 | **[1, 10]**, mean 5.6 | **[25, 49]**, mean 35.9 |
| example user | 5 | 36 |

The eval (AUC/F1/stability) was computed on the `headlessScorer` path. The UI
**recomputes** trollIndex from raw scores and displays that — it does not use the
backend's trollIndex field. So **the number the eval validates is not the number
the UI shows.** This is the most important thing to resolve before trusting any
per-user read. (Both formulas use the same axis scores and near-identical weights,
so their *rankings* are very similar — see §1 — but their scales are unrelated.)

## 1. Discrimination

AUC-ROC is consistent across both trollIndex formulas (same underlying scores):

| trollIndex | AUC-ROC | bootstrap 95% CI |
|---|---|---|
| headlessScorer (calibrated) | 0.659 | [0.549, 0.772] |
| **UI (raw-weighted, displayed)** | **0.663** | **[0.548, 0.777]** |

Above random (CI excludes 0.5), **moderate** — below the review's ≥0.75 gate.
Best F1 on the UI trollIndex is **0.507 @ threshold 25** (P=0.34 ≈ base rate,
R=1.0) — i.e. precision never beats the 34% base rate. Useful as a weak ranking,
useless as a binary classifier. Calibration poor on 2/4 axes (toxicEmotions ECE
0.42, missingIntelligibility ECE 0.41).

## 2. Stability (person-level · split-half, headlessScorer trollIndex)

| Lexicon | Pearson r | 95% CI | Spearman ρ |
|---|---|---|---|
| default | 0.049 | [-0.165, 0.258] | 0.030 |
| full (5711 terms) | 0.055 | [-0.158, 0.264] | 0.044 |

Both CIs span zero. The composite is **not stable** across a user's two
comment-halves. (Measured on the headlessScorer trollIndex; UI-trollIndex stability
not separately computed, but ranking similarity to §1 suggests it is comparable.)

## 3. Risk bands — NOT broken (correction)

Under the existing `getRiskBand` thresholds (45 / 70) the **displayed** trollIndex
on the N=100 random sample splits **0 / 20 / 80** (高 / 混 / 低). The '高频' band
(≥70) is unreachable on this sample, but the sample is random Bilibili users
(skewed low-toxicity) — 80% low is plausible, and '高频' being empty here does not
mean the thresholds are wrong for the actual (targeted, higher-toxicity) use case.
**No recalibration is justified from a random sample.** (Retracted: the earlier
"every user lands in 低频" claim measured the wrong trollIndex.)

## 4. ≥10-comment gate (kept)

`src/main.jsx` now gates the categorical band on ≥10 analyzed comments
(the raw trollIndex still shows). This is independent of the scale issue above and
correct regardless — a band on <10 comments overclaims.

## Refined verdict (evidence-backed)

- **Screening ranker**: weakly useful — AUC 0.66 (CI excludes random). Below its
  own 0.75 gate.
- **Classifier**: poor — best F1 ≈ base rate.
- **Trait descriptor**: unsupported — r ≈ 0.05 unstable.
- **Live vs eval are separate implementations — both now measured.** The UI
  (`src/main.jsx`, raw-weighted, [25,49]) measures AUC 0.663; the eval
  (`server/services/headlessScorer.js`, calibrated, [1,10], **offline scripts
  only**) measures 0.659. Ranking-equivalent, scale-divergent. Not "validated vs
  unvalidated" — both have evidence. Unifying them into one canonical scorer is a
  larger optional follow-up, not a validity blocker.

## Recommended next actions (ranked)

1. ~~Reconcile the two `getTrollIndex` paths (was: "real blocker")~~ **Corrected
   (2026-07-02):** the live UI trollIndex *is* measured (AUC 0.663) — the earlier
   "unvalidated" framing was imprecise. Dead duplicate `src/components/ResultsView.jsx`
   removed; a live/eval architecture note added to `src/main.jsx:getTrollIndex`.
   Remaining *optional* work: unify `main.jsx` (live) and `headlessScorer.js` (eval)
   into one scorer if a single canonical implementation is wanted — larger refactor,
   since headlessScorer is offline-only and never served the UI.
2. **Reframe claims**: "weak screening ranker," never "classifier" or "trait."
3. Collect a use-case-population sample (not random) before any band tuning.
4. The ≥10-comment gate stands.

## Artifacts

- `metrics.json`, `report.md` — step-5/6 eval output (headlessScorer trollIndex)
- `stability_report.md` — split-half detail (headlessScorer trollIndex)
- `scored/100`, `annotated/100` — per-user raw data (not committed; reproducible)

## Reproduce

```bash
node server/scripts/runRandomSamplingEval.js --step 1   # sample
node server/scripts/runRandomSamplingEval.js --step 2   # extract
node server/scripts/runRandomSamplingEval.js --step 3   # score (local)
# step 4 needs DEEPSEEK_API_KEY (~300 paid calls):
powershell -NoProfile -Command ". ./set-deepseek-env.ps1; node server/scripts/runRandomSamplingEval.js --step 4"
node server/scripts/runRandomSamplingEval.js --step 5   # metrics (headlessScorer trollIndex)
node server/scripts/runRandomSamplingEval.js --step 6   # report
node server/scripts/splitHalfReliability.js --full-lexicon   # stability
```
