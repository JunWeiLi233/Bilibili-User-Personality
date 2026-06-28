# Scoring Discrimination Fix Plan

> Diagnosed 2026-06-28. Root cause: keyword-density scoring produces near-identical scores for all users because high-frequency neutral Chinese words dominate the feature space. AUC=0.502, trollIndex separation=0.7pts, ρ=0.088.

## Root Cause Summary

| Problem | Evidence |
|---------|----------|
| Common function words tagged as risk | `没有` in 72% of users, `都是` 46%, `肯定` 20% — all tagged "absolutes/risk" |
| Neutral expressions tagged as attack | `哈哈哈` (laughter) in 43% of users tagged "attack/risk" |
| Support terms increase risk scores | `打call`, `笑哭`, `我觉得`, `为什么` all mapped to risk axes |
| Noise floor = 50-60pts, signal = 5pts | POS-vs-NEG mean difference: toxicEmotions 5.1pts, trollIndex 0.7pts |

Three paths — not mutually exclusive. Recommended order: A → B → C (each builds on the last).

---

## Path A: Term Frequency Filter (quick win — 30 min)

**Goal:** Remove or zero-weight terms that appear in >30% of users — they mathematically cannot discriminate.

**What "high frequency" means:** A term appearing in 72% of users tells you nothing about which users are argumentative. It's the linguistic equivalent of flagging "the" or "is" in English.

### Step A1: Build a reference frequency table

**File:** new script `server/scripts/buildTermFrequencyTable.js`

Compute per-term user prevalence from a reference corpus. Use either:
- The 100-user eval corpus (`.claude/random_sampling_eval/user_data/`) — already scraped, 100 users, ready to use
- Or the full `bilibiliHistoryTagCorpus.json` for better coverage

Output: `server/data/termFrequency.json`
```json
{
  "没有": { "userCount": 72, "totalCount": 221, "userFraction": 0.72 },
  "装":   { "userCount": 49, "totalCount": 106, "userFraction": 0.49 },
  ...
}
```

### Step A2: Add frequency threshold to scoring pipeline

**File:** `src/main.jsx` (or `src/languageUnderstanding.js` — wherever `vocabularyMarks` are converted to axis scores)

Add a `MAX_USER_FRACTION` constant (default 0.30). When scoring, skip any term where `userFraction > MAX_USER_FRACTION`. Log how many terms are filtered per user.

```js
const MAX_USER_FRACTION = 0.30;
// During scoring:
const filteredMarks = vocabularyMarks.filter(mark => {
  const freq = termFrequency[mark.term];
  return !freq || freq.userFraction <= MAX_USER_FRACTION;
});
```

### Step A3: Re-score and re-evaluate

1. Re-run scoring on the 100-user eval set with filtered terms
2. Re-run evaluation metrics (AUC, F1, per-axis Brier/ECE, separation)
3. Compare before/after

**Expected impact:** Noise floor drops from 50-60 → 25-35. Axis separation doubles from ~3-5pts → ~6-10pts. AUC should move from 0.50 → 0.55-0.60.

### Step A4: Config-driven threshold

Make `MAX_USER_FRACTION` configurable via env var `BILIBILI_TERM_FREQ_THRESHOLD` (default 0.30). Add to `readCrawlerConfig()` or a new `readScoringConfig()`.

---

## Path B: Fix Polarity/Axis Misclassification (quick win — 20 min)

**Goal:** Fix obviously wrong term classifications. Laughter is not attack. Supportive language should not increase risk scores.

### Step B1: Fix high-impact misclassifications

**File:** `server/data/deepseekKeywordDictionary.production.json` (and its `.entries/` and `.evidence/` subdirectories)

Terms to fix immediately:

| Term | Current | Should Be | Reason |
|------|---------|-----------|--------|
| `哈哈哈` | family=attack, polarity=risk | **neutral or remove from dict** | It's laughter. 43% prevalence, 156 occurrences across 100 users |
| `笑哭` | axis=逻辑混乱, polarity=support | **keep support but remove axis mapping** | Crying-laughing emoji — supportive, not about intelligibility |
| `打call` | axis=逻辑混乱, polarity=support | **keep support but remove axis mapping** | Means "cheer/support" — positive, not about logic |
| `吃瓜` | axis=逻辑混乱, polarity=support | **keep support but remove axis mapping** | Means "watching drama as bystander" — neutral |
| `我觉得` | axis=逻辑混乱, polarity=support | **keep support but remove axis mapping** | "I think" — expressing personal view, not logical failure |
| `为什么` | axis=逻辑混乱, polarity=support | **neutral** | "Why" — asking questions, not evidence |

### Step B2: Add a rule — support-polarity terms must not increase risk

**File:** `src/languageUnderstanding.js` (or wherever axis scores are computed)

When accumulating per-axis scores, support-polarity terms should either:
- (a) Subtract from the risk score (evidence of cooperative behavior), or
- (b) Be excluded from the risk score entirely

Implement option (b) as default — simplest, least disruptive:
```js
// Only risk-polarity terms contribute to axis score
const riskMarks = vocabularyMarks.filter(m => m.polarity === 'risk');
```

### Step B3: Re-score and re-evaluate

Same verification as A3.

**Expected impact:** Removes false-positive signal from 30-43% of users. Cooperative users stop getting penalized for using supportive language. Axis scores become more honest (only risk terms contribute to risk scores).

---

## Path C: IDF-Weighted Scoring (structural fix — 1 hour)

**Goal:** Replace raw keyword counts with TF-IDF weighting. Common terms get near-zero weight automatically. Rare but diagnostic terms get amplified. No need to manually curate a blocklist — the math handles it.

### Step C1: Understand the current scoring formula

Read `src/main.jsx` and `src/languageUnderstanding.js` to identify where `vocabularyMarks` counts are converted to per-axis scores. Document the current formula (likely: sum of raw counts per axis, normalized to 0-100).

### Step C2: Implement IDF-weighted axis scoring

**File:** `src/languageUnderstanding.js` (new exported function)

```js
/**
 * Compute IDF-weighted axis scores from vocabulary marks.
 * IDF = log(N / df) where N = total users in reference corpus, df = users containing term.
 *
 * Raw count → weighted count: weightedCount = rawCount * idf
 * Then normalize weighted counts to 0-100 per axis.
 */
export function computeIdfWeightedScores(vocabularyMarks, termFrequency, N = 100) {
  const axisScores = { toxicEmotions: 0, missingCommitment: 0, missingIntelligibility: 0, otherReasons: 0 };
  
  for (const mark of vocabularyMarks) {
    if (mark.polarity !== 'risk') continue; // Path B: only risk terms
    const freq = termFrequency[mark.term];
    const df = freq ? freq.userCount : 1; // default df=1 for unknown terms
    const idf = Math.log(N / df);
    const weightedCount = (mark.count || 0) * idf;
    
    const axis = mapChineseAxisToCategory(mark.axis);
    if (axisScores[axis] !== undefined) {
      axisScores[axis] += weightedCount;
    }
  }
  
  // Normalize to 0-100 (requires calibration — see Step C3)
  return normalizeAxisScores(axisScores);
}
```

### Step C3: Calibrate normalization

IDF-weighted scores are on a different scale than raw counts. Need to determine:
- Max plausible weighted score per axis (for ceiling normalization)
- Or use percentile-based normalization (rank among reference corpus)

Simplest approach: compute weighted scores for all 100 eval users, find per-axis max, normalize by max×1.1 (10% headroom). If a new user exceeds max, cap at 100.

### Step C4: Wire into the scoring pipeline

Replace the current raw-count accumulation with `computeIdfWeightedScores()`. The vocabulary marks data doesn't change — only how counts are converted to scores.

### Step C5: Re-score and re-evaluate

Full before/after comparison on all 6 metrics.

**Expected impact:** This is the structural fix. Terms like `没有` (df=72, idf=0.14) get 7× less weight than before. Terms like `没文化` (df≈5, idf=1.3) get roughly the same weight. The noise floor collapses and signal amplifies. AUC should move from 0.50 → 0.60-0.70.

---

## Implementation Order

```
Path A (30 min)  ──→  Re-evaluate  ──→  Path B (20 min)  ──→  Re-evaluate  ──→  Path C (1 hr)  ──→  Final eval
```

Each path is independently valuable. Stop after any path if targets are met.

## Files Affected

| File | Path | Action |
|------|------|--------|
| `buildTermFrequencyTable.js` | New → `server/scripts/` | Create frequency table script |
| `termFrequency.json` | New → `server/data/` | Output of frequency script |
| `src/main.jsx` | Existing | Wire frequency filter + IDF scoring |
| `src/languageUnderstanding.js` | Existing | Add `computeIdfWeightedScores()`, filter logic |
| `deepseekKeywordDictionary.production.json` | Existing | Fix misclassified terms (Path B) |
| `server/scripts/runRandomSamplingEval.js` | Existing (maybe) | Re-run scoring + evaluation |

## Verification

After each path:
```bash
# Re-score the 100-user eval set
node server/scripts/runRandomSamplingEval.js --rescore-only

# Re-evaluate metrics
node server/scripts/runRandomSamplingEval.js --evaluate-only

# Compare
node server/scripts/compareEvalResults.js .claude/random_sampling_eval/metrics.json .claude/random_sampling_eval/metrics_after.json
```

## Targets

| Metric | Current | After A+B | After A+B+C |
|--------|---------|-----------|-------------|
| AUC-ROC | 0.502 | ≥0.55 | ≥0.65 |
| trollIndex separation | 0.7 pts | ≥5 pts | ≥10 pts |
| F1 | 0.54 | ≥0.55 | ≥0.60 |
| Best ρ | 0.088 | ≥0.15 | ≥0.30 |
