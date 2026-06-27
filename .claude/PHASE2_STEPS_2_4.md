# Phase 2 Steps 2–4 — Sparse Axes + Cross-Domain + Ship

> 2026-06-27. Executes the remaining three steps from PHASE2_PLAN.md.
> Step 1 (Quality Fixes) is already done: threshold 0.75, _telemetry live, MINIMUM_TERMS_PER_FAMILY=6, 1,339 tests pass.

---

## Step 2: Expand Sparse Axes (~1.5h)

**Target families:**

| Family | Current | Target |
|--------|---------|--------|
| evasion | 93 terms | ≥120 terms |
| evidence | 57 terms | ≥85 terms |
| correction | 54 terms | ≥80 terms |

### 2a. Harvest terms from seed corpus

```
node server/scripts/runCoverageHarvestLoop.js --focus-family evasion --terms-per-family 20
node server/scripts/runCoverageHarvestLoop.js --focus-family evidence --terms-per-family 20
node server/scripts/runCoverageHarvestLoop.js --focus-family correction --terms-per-family 20
```

### 2b. If corpus harvest falls short, use DeepSeek

Prompt `/api/deepseek/train-keywords` with corpus text rich in the target discourse pattern. Generate 20–30 additional Bilibili-specific Chinese terms per family. Merge via:

```
node server/mergeAgentDictionaries.js <new-terms-dir>
```

### 2c. Curate

- Remove duplicates against existing dictionary entries
- Verify Chinese authenticity (no machine-translation artifacts)
- Ensure each term has at least one evidence sample or plausible Bilibili usage

### 2d. Validate

```
npm run dictionary:coverage    # verify activation rates improved
npm test                        # must stay at ≥1,339 pass
npm run stats:update            # refresh README stats + SVGs
```

**Gate 2:** evasion ≥120, evidence ≥85, correction ≥80 terms. npm test green.

---

## Step 3: Cross-Domain Validation (~2h)

All 763 seed files are history-domain. Test on gaming (Bilibili's largest category).

### 3a. Scrape gaming-domain UIDs

```
node server/scripts/mineSeedVideos.js --seed 游戏 --maxVideos 5
```

### 3b. Extract UIDs from gaming video comment sections

Use browser-harness or the AICU API to pull commenter UIDs. Target: ≥100 unique UIDs.

### 3c. Cross-reference & select

Cross-reference against `server/data/aicu-user-database.json` (5,864 users). Select 50–100 users with ≥20 comments each. Prefer users not already in the history-domain baseline.

### 3d. Run analysis

For each selected UID, run the full pipeline: scrape → keyword match → scoreComments. Aggregate.

### 3e. Write comparison report → `.claude/CROSS_DOMAIN_REPORT.md`

Compare axis distributions between history-domain (existing 100-user baseline) and gaming-domain:

- **Expected:** Gaming → higher attack, lower cooperation, more meme/emote density
- **If axes shift predictably:** model measures discourse patterns, not memorized vocabulary
- **If axes don't shift:** model may be overfit to history-domain vocabulary

Include per-axis before/after tables and a verdict on domain robustness.

### 3f. Stats refresh

```
npm run stats:update
```

**Gate 3:** `.claude/CROSS_DOMAIN_REPORT.md` written with axis comparison tables.

---

## Step 4: Commit & Push (~2 min)

```bash
git add server/data/deepseekKeywordDictionary.*/
git add server/services/semanticMatcher.js
git add server/services/keywordHarvest.js
git add docs/stats/
git add README.md
git add .claude/CROSS_DOMAIN_REPORT.md
git add .claude/PHASE2_PLAN.md
git add .claude/PHASE2_STEPS_2_4.md
git add .claude/IMPLEMENTATION_AUDIT.md
git add .claude/NEXT_STEPS.md
git add .claude/ANALYSIS_TRUNCATION_REPORT.md
git commit -m "feat: Phase 2 complete — sparse axis expansion + cross-domain validation + quality fixes"
git push
```

**Gate 4:** Push succeeds, no conflicts.

---

## Verification Gates

| After Step | What to Verify |
|------------|---------------|
| 2d | evasion ≥120, evidence ≥85, correction ≥80 terms |
| 2d | npm test ≥1,339 pass, same 5 pre-existing failures |
| 3e | `.claude/CROSS_DOMAIN_REPORT.md` written with before/after axis tables |
| 4 | Push succeeds |
