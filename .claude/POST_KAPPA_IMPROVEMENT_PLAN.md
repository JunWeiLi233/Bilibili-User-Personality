# Post-κ Improvement Plan — 5 Steps to Production Readiness

> 2026-06-28. The 3-annotator consensus pipeline proved κ > 0.6 on all 4 axes (val_30: TE=0.81, MC=0.75, MI=0.93, OR=0.67).
> This plan covers the 5 next steps to harden the pipeline for production.

## Current State

| Item | Status |
|------|--------|
| 3-annotator κ validation | 30-comment proof-of-concept done; full 300 TBD |
| Multi-sense disambiguation | Code complete; NOT wired to commentCoverage.js |
| Polysemy dictionary migration | 14 terms defined; JSON files NOT updated (`--apply` not run) |
| Human calibration | None |
| Multi-model annotators | All 3 annotators are DeepSeek |

---

## Step 1: Scale 3-Annotator Validation to 300 Comments

### Why
30 comments is noisy — one disagreement moves κ by 0.03. At n=300, κ estimates stabilize to ±0.03 confidence intervals. The A1 (balanced) annotator already has 134/300 done. We need to finish A1, run A2 (calibrated), then A3 (consensus) on all 300.

### What to do

1. **Finish A1** (balanced) on remaining 166 comments starting from entry 134:
   ```bash
   node server/scripts/annotateLabelsWithDeepSeek.js \
     --annotator A1 --variant default \
     --input .claude/annotation_data/argumentative_candidates.json \
     --output .claude/annotation_data/argumentative_candidates.json \
     --batch-size 50 --start 134
   ```

2. **Run A2** (calibrated) on all 300:
   ```bash
   node server/scripts/annotateLabelsWithDeepSeek.js \
     --annotator A2 --variant calibrated \
     --input .claude/annotation_data/argumentative_candidates.json \
     --output .claude/annotation_data/argumentative_candidates.json \
     --batch-size 50 --start 0
   ```

3. **Run A3** (consensus) on all 300 (requires A1+A2 complete):
   ```bash
   node server/scripts/annotateLabelsWithDeepSeek.js \
     --annotator A3 --variant consensus \
     --input .claude/annotation_data/argumentative_candidates.json \
     --output .claude/annotation_data/argumentative_candidates.json \
     --batch-size 50 --start 0
   ```

4. **Compute κ** with majority consensus:
   ```bash
   python -m python_backend.analysis.validation_metrics \
     --input .claude/annotation_data/argumentative_candidates.json \
     --output-kappa .claude/annotation_data/kappa_argumentative_300.json \
     --annotators A1,A2,A3 --consensus majority --full-report
   ```

5. **Update UI** with n=300 κ values in `src/main.jsx`.

### Gate
≥3 of 4 axes with consensus κ ≥ 0.6 on the full 300. If the 0.82 from val_30 holds ≥0.7, the pipeline is production-ready.

### Files
- `server/scripts/annotateLabelsWithDeepSeek.js` — no changes needed (already supports all variants)
- `python_backend/analysis/validation_metrics.py` — no changes needed
- `src/main.jsx` — update kappaStatus with 300-comment values and provenance
- `.claude/annotation_data/kappa_argumentative_300.json` **(NEW)**

---

## Step 2: Wire Polysemy Disambiguation into commentCoverage.js

### Why
The previous goal built `disambiguateSenseHits()`, `classifyScenario()`, and `contextClassifier.js` — a complete context-aware disambiguation layer. But it's **not connected** to the live matching pipeline. The 40+ ad-hoc `isSuppressed*` functions in `commentCoverage.js` handle the same problem (context-dependent FP suppression) with brittle, term-specific heuristics. Wiring disambiguation in would:

- Cut false positives by resolving "急了" as attack vs reassurance based on surrounding text
- Simplify `commentCoverage.js` by allowing deprecation of ad-hoc suppressors
- Make the 14 multi-sense dictionary entries actually matter at runtime
- Reduce the FP rate from the current estimated 35-50% toward the 15-25% target

### What to do

1. **Read `commentCoverage.js`** — map the `classifyCommentCoverage` call chain and identify where keyword hits flow into coverage decisions.

2. **Add a `disambiguateBeforeClassify` hook** in `classifyCommentCoverage` (or a wrapper):
   - For each keyword hit, call `disambiguateSenseHits(hits, commentText, senseIndex, { scenario })`
   - Hits that resolve to a low-risk sense (e.g., 急了→reassurance) get their risk downgraded or filtered
   - Hits that resolve to a high-risk sense (e.g., 急了→taunting) keep their original classification

3. **Integrate `classifyScenario`** — call it once per comment, pass the scenario to disambiguation:
   ```js
   const scenario = classifyScenario(commentText).scenario;
   const disambiguated = disambiguateSenseHits(rawHits, commentText, senseIndex, { scenario });
   ```

4. **Audit the 40+ `isSuppressed*` functions** — identify which ones are made redundant by disambiguation. For each:
   - If the suppression logic matches a sense's `contextAntiHints` → mark deprecated
   - If the suppression logic is unique (not covered by any sense) → keep as-is
   - Generate a deprecation report: `{ total: N, deprecated: M, retained: K }`

5. **Write tests** in `server/services/commentCoverage.test.js`:
   - 急了 in reassuring context → NOT classified as attack
   - 急了 in taunting context → classified as attack
   - 逆天 in praise context → NOT classified as attack
   - Single-sense terms pass through unchanged
   - Existing coverage tests still pass

6. **Measure FP reduction** — run the coverage audit before and after:
   ```bash
   npm run dictionary:coverage  # before
   # ... wire disambiguation ...
   npm run dictionary:coverage  # after
   ```
   Compare zero-evidence term counts. Target: ≥20% reduction in false positives.

### Files
- `server/services/commentCoverage.js` — add disambiguation hook
- `server/services/commentCoverage.test.js` — add disambiguation tests
- `server/services/deepseekKeywordTrainer.js` — no changes needed (already exports everything)
- `server/services/contextClassifier.js` — no changes needed

---

## Step 3: Apply Polysemy Dictionary Migration (--apply)

### Why
The 14 multi-sense entries (急了, 逆天, 典中典, 啊对对对, 插眼, 对对对, 反转了, 谜语人, 受教了, 下次一定, 学习了, 一言难尽, 张口就来, 指路) are fully defined in `polysemy_audit.py` with contextHints, contextAntiHints, and scenario assignments. The migration script (`polysemy_migrate.py`) was tested with `--dry-run` and confirmed correct. But the **actual JSON dictionary files** still have single-sense entries. The dictionary is out of sync with the code.

### What to do

1. **Run the migration** (in a branch):
   ```bash
   git checkout -b feat/polysemy-migration-apply
   python -m python_backend.cli.polysemy_migrate --apply
   ```

2. **Verify** the modified shard files:
   ```bash
   # Check that 14 terms now have multi-sense entries
   grep -r '"senses"' server/data/deepseekKeywordDictionary.entries/ | wc -l
   # Run coverage to confirm no regressions
   npm run dictionary:coverage
   ```

3. **Run full test suite**:
   ```bash
   npm test
   python -m pytest python_backend/tests/ -x -q
   ```

4. **Run the coverage audit** to confirm:
   ```bash
   npm run dictionary:coverage
   python -m python_backend.analysis.polysemy_audit
   ```
   The audit should show 14 terms with `has_senses_defined: true` in the candidates list.

5. **Commit & merge** if all tests pass.

### Gate
All JS + Python tests pass. Coverage audit shows no regressions. `normalizeEntryToMultiSense()` correctly wraps the new multi-sense entries at runtime.

### Files
- `server/data/deepseekKeywordDictionary.entries/*.json` — 14 terms updated from single-sense to multi-sense
- `python_backend/cli/polysemy_migrate.py` — already written, just needs `--apply`

---

## Step 4: Human Calibration Set (30 comments, ≥2 reviewers)

### Why
The 3-annotator DeepSeek consensus gives κ = 0.82, but all 3 annotators are the same underlying model (DeepSeek). This might inflate κ — models can share blind spots. A human calibration set establishes:

- **True κ ceiling**: How well CAN humans agree on these Bilibili comments?
- **Model calibration**: Does DeepSeek consensus correlate with human judgment?
- **Systematic bias detection**: Does DeepSeek over-flag or under-flag any axis?

### What to do

1. **Select 30 comments** from the val_30 set (already annotated by A1/A2/A3). These have consensus labels to compare against.

2. **Create annotation guide** (1-page Chinese instructions):
   - 4 axes with examples of what "0", "1", "2" mean for each
   - 3 worked examples showing clear cases
   - Explicit instruction: "rate the comment, not the person; focus on the text"

3. **Recruit ≥2 human reviewers** who:
   - Read Chinese fluently
   - Are familiar with Bilibili comment culture
   - Have NOT seen the DeepSeek annotations

4. **Collect annotations** — each reviewer independently rates all 30 comments on the 4 axes (0-2 scale).

5. **Compute human κ and human-vs-model κ**:
   ```bash
   python -m python_backend.analysis.validation_metrics \
     --input .claude/annotation_data/human_calibration.json \
     --output-kappa .claude/annotation_data/kappa_human.json \
     --annotators Human1,Human2 --full-report
   ```

6. **Compare**:
   - Human-human κ vs DeepSeek-DeepSeek κ
   - Human consensus vs DeepSeek consensus
   - Per-axis bias: does DeepSeek systematically rate higher/lower than humans?

7. **Document** in `docs/human-calibration-report.md` with findings and recommendations.

### Gate
Human-human κ establishes the honest ceiling. If human κ ≥ 0.7, the model's 0.82 is within range. If human κ < 0.6, the task itself has inherent ambiguity and κ = 0.4-0.6 is the realistic ceiling.

### Files
- `.claude/annotation_data/human_calibration_guide.md` **(NEW)** — annotation instructions
- `.claude/annotation_data/human_calibration.json` **(NEW)** — human annotations
- `.claude/annotation_data/kappa_human.json` **(NEW)** — human κ report
- `docs/human-calibration-report.md` **(NEW)** — findings and analysis

---

## Step 5: Multi-Model Annotator Diversity

### Why
A1, A2, and A3 are all DeepSeek with different prompts. This is prompt diversity, not model diversity. Different models (DeepSeek, Claude, GPT-4) have different:
- Sensitivity to Chinese sarcasm and irony
- Tendency to over-flag or under-flag borderline cases
- Understanding of Bilibili-specific meme culture

Multi-model annotation would:
- Make consensus κ more honest (models with different architectures disagree more)
- Surface prompt-specific biases (e.g., "does Claude flag more toxicEmotions than DeepSeek?")
- Better approximate true inter-rater reliability for a production system

### What to do

1. **Add multi-model support to the annotation script** — accept `--model` flag:
   ```bash
   node server/scripts/annotateLabelsWithDeepSeek.js \
     --annotator A4 --variant balanced --model claude-sonnet-4-6 \
     --input .claude/annotation_data/val_30.json --batch-size 30
   ```
   This requires adding a Claude API client alongside the existing DeepSeek client, or generalizing the `chatCompletion` function to route by model.

2. **Or: use browser-harness** to call Claude via the existing MCP tools if direct API access isn't available.

3. **Run A4 (Claude, balanced) and A5 (GPT-4, balanced)** on the 30-comment validation set.

4. **Compute cross-model κ**:
   ```bash
   python -m python_backend.analysis.validation_metrics \
     --input .claude/annotation_data/val_30_multimodel.json \
     --output-kappa .claude/annotation_data/kappa_multimodel.json \
     --annotators A1,A4,A5 --consensus majority
   ```

5. **Compare** DeepSeek-only consensus κ vs cross-model consensus κ. If cross-model κ drops below 0.6, the pipeline needs prompt tuning per model.

### Gate
Cross-model consensus κ ≥ 0.6 on ≥3 axes. If not, per-model prompt calibration is needed before production deployment.

### Files
- `server/scripts/annotateLabelsWithDeepSeek.js` — generalize to multi-model (or create new script)
- `.claude/annotation_data/val_30_multimodel.json` **(NEW)**
- `.claude/annotation_data/kappa_multimodel.json` **(NEW)**

---

## Dependency Graph

```
Step 1 (scale to 300) ── independent, can run anytime
    │
    └── updates kappaStatus in UI with n=300 values

Step 2 (wire disambiguation) ── depends on Step 3 (dictionary must be migrated first)
    │
    └── Step 3 (polysemy --apply) ── prerequisite for Step 2

Step 4 (human calibration) ── independent, requires 2+ human reviewers
    │
    └── provides ground truth for κ ceiling

Step 5 (multi-model) ── independent, requires multi-API access
    │
    └── validates that κ holds across model architectures
```

## Recommended Execution Order

| # | Step | Blocks | Estimated Time |
|---|------|--------|----------------|
| 1 | Scale to 300 comments | Nothing | 45 min (API) |
| 3 | Apply polysemy migration | Nothing | 5 min + test run |
| 2 | Wire disambiguation | Step 3 | 60-90 min (integration) |
| 4 | Human calibration | Nothing (logistics) | Days (recruit + annotate) |
| 5 | Multi-model annotators | Nothing (API access) | 60 min + API costs |

**Steps 1 + 3 can run in parallel.** Step 2 should follow Step 3. Steps 4 and 5 are independent long-term improvements.

## Files Changed (cumulative)

| File | Step | Action |
|------|------|--------|
| `server/data/deepseekKeywordDictionary.entries/*.json` | 3 | 14 terms updated to multi-sense |
| `server/services/commentCoverage.js` | 2 | Add disambiguation hook |
| `server/services/commentCoverage.test.js` | 2 | Add disambiguation tests |
| `src/main.jsx` | 1 | Update kappaStatus with n=300 values |
| `.claude/annotation_data/kappa_argumentative_300.json` | 1 | **NEW** |
| `.claude/annotation_data/human_calibration_guide.md` | 4 | **NEW** |
| `.claude/annotation_data/human_calibration.json` | 4 | **NEW** |
| `.claude/annotation_data/kappa_human.json` | 4 | **NEW** |
| `docs/human-calibration-report.md` | 4 | **NEW** |
| `.claude/annotation_data/kappa_multimodel.json` | 5 | **NEW** |
| `server/scripts/annotateLabelsWithDeepSeek.js` | 5 | Generalize to multi-model |

## Gates (cumulative)

| Gate | Step | Criteria |
|------|------|----------|
| Scale validation | 1 | ≥3/4 axes κ ≥ 0.6 at n=300 |
| Dictionary sync | 3 | All JS + Python tests pass; coverage audit clean |
| FP reduction | 2 | ≥20% reduction in false positives; deprecated suppressor count |
| Human ceiling | 4 | Human κ establishes honest ceiling; model bias quantified |
| Cross-model κ | 5 | ≥3/4 axes κ ≥ 0.6 across model architectures |
