# Phase 2 Plan — Quality Fixes + Sparse Axes + Cross-Domain

> 2026-06-27. Covers audit fixes Q1–Q3, MASTER_PLAN Phase 2a/2b/2c.

---

## Step 1: Quality Fixes (~5 min)

### 1a. Raise semantic match threshold
**File:** `server/services/semanticMatcher.js:9`
```
DEFAULT_THRESHOLD = 0.65  →  0.75
```
Currently produces 13,650 false matches for 140 comments. At 0.75, only real semantic neighbors survive. Test: rerun `npm test` — the 5 pre-existing semantic failures may change behavior (better or worse), but the 1337 other tests must stay green.

### 1b. Restart server
Kill the running `npm run server` process and restart it. Verifies `_telemetry` appears in `/api/deepseek/semantic-match` response. Test: `curl -X POST .../semantic-match | python -c "import sys,json; print('_telemetry' in json.load(sys.stdin))"` → `True`.

---

## Step 2: Expand Sparse Axes (~1.5h)

**Target families:** evasion (93 terms, 1.2% activation), evidence (57 terms, 2.2%), correction (54 terms, 0.6%).

### 2a. Generate terms via DeepSeek

For each family, prompt DeepSeek to generate 20–40 Chinese Bilibili-specific terms. Use the existing `generateKeywordEntries` infrastructure with a targeted prompt:

```bash
# Pattern (one per family):
node server/scripts/generateTermsForFamily.js --family evasion --count 30
node server/scripts/generateTermsForFamily.js --family evidence --count 30
node server/scripts/generateTermsForFamily.js --family correction --count 30
```

If no dedicated script exists, use the `/api/deepseek/train-keywords` endpoint with existing corpus text that's rich in the target family, or write a quick prompt harness.

### 2b. Curate & merge
- Remove duplicates against existing dictionary
- Verify Chinese authenticity (no machine-translation artifacts)
- Merge into `server/data/deepseekKeywordDictionary.entries/<family>-*.json`

```bash
node server/mergeAgentDictionaries.js <new-terms-dir>
```

### 2c. Validate
```bash
npm run dictionary:coverage    # check new activation rates
node --test src/utils/extractUid.test.js  # existing tests still pass
npm test                        # 1337 pass, same 5 known failures
```

### 2d. Stats refresh
```bash
npm run stats:update
```

**Success criteria:**
| Family | Before | After Target |
|--------|--------|-------------|
| evasion | 93 terms | ≥120 terms |
| evidence | 57 terms | ≥85 terms |
| correction | 54 terms | ≥80 terms |

---

## Step 3: Cross-Domain Validation (~2h)

All 763 seed files are history-domain. Test on gaming (Bilibili's largest category).

### 3a. Scrape gaming UIDs
```bash
# Use browser-harness or mineSeedVideos to get gaming commenter UIDs
node server/scripts/mineSeedVideos.js --seed 游戏 --maxVideos 5
```

### 3b. Extract UIDs from gaming videos
Use browser-harness to visit top gaming videos, extract commenter UIDs from the comment section or via AICU API.

### 3c. Cross-reference & select
Cross-reference against `server/data/aicu-user-database.json` (5,864 users). Select 50–100 users with ≥20 comments.

### 3d. Run analysis
For each selected UID, run the full pipeline (scrape → keyword train → scoreComments). Aggregate results.

### 3e. Write comparison report
Compare axis distributions between history-domain (existing 100-user baseline) and gaming-domain:
- **Expected:** Gaming → higher attack, lower cooperation, more meme/emote density
- **If axes shift predictably:** model measures discourse patterns, not memorized vocabulary
- **If axes don't shift:** model may be overfit to history-domain vocabulary

### 3f. Stats refresh
```bash
npm run stats:update
```

---

## Step 4: Commit & Push (~2 min)

```bash
git add server/data/deepseekKeywordDictionary.*/
git add server/services/semanticMatcher.js
git add docs/stats/
git add README.md
git add .claude/IMPLEMENTATION_AUDIT.md
git add .claude/PHASE2_PLAN.md
git add .claude/NEXT_STEPS.md
git add .claude/ANALYSIS_TRUNCATION_REPORT.md
git commit -m "feat: Phase 2 — sparse axis expansion + cross-domain validation + quality fixes"
git push
```

---

## Verification Gates

| After Step | What to Verify |
|------------|---------------|
| 1a | `npm test` — 1337 pass, no regressions |
| 1b | `_telemetry` key present in semantic-match response |
| 2c | evasion ≥120, evidence ≥85, correction ≥80 terms |
| 2c | `npm test` still green |
| 3e | Comparison report written, axis shifts documented |
| 4 | Push succeeds, no conflicts |

---

## Total Estimated Time

| Step | Est. |
|------|------|
| 1. Quality fixes | 5 min |
| 2. Expand sparse axes | 1.5h |
| 3. Cross-domain validation | 2h |
| 4. Commit & push | 2 min |
| **Total** | **~3.5h** |
