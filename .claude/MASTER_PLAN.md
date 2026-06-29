# Master Plan — Bilibili User Personality

> Generated 2026-06-26 after 100-user model validation (94% coverage, 1,782 hits, 6/6 axes active).
> Current state: model works. Cooperation (50.9%) dominates. Sparse axes: evasion (1.2%), correction (0.6%), evidence (2.2%).
>
> **Total estimated runtime: ~5–8 hours**

| Phase | Est. Time |
|-------|-----------|
| Phase 1 — Quick Wins | ~5 min |
| Phase 2 — High-Value | ~2–2.5 hours |
| Phase 3 — Transform the Codespace | ~3–5 hours |

---

## Phase 1 — Quick Wins (~5 min)

### 1a. Dictionary Coverage Audit
```bash
npm run dictionary:coverage
```
Shows which families/terms are underperforming. Outputs to `server/data/keywordCoverageAudit.json`.

### 1b. Prune Exhausted Terms
```bash
npm run dictionary:prune-exhausted
```
Removes terms with no remaining discovery path. Shrinks dictionary, improves signal-to-noise.

### 1c. Refresh README Stats
```bash
npm run stats:update
```
Updates README stats block + SVG graphs to reflect latest dictionary/corpus state.

---

## Phase 2 — High-Value (~1.5 hours)

### 2a. Cross-Domain Validation

**Problem:** All 763 seed files are history-domain (历史/中华/战争/etc). Model needs testing on different discourse types.

**Steps:**
1. Scrape seed videos for a new domain — "游戏" (gaming, Bilibili's largest category) or "科技" (tech)
2. Use browser-harness to extract ~500 commenter UIDs from top gaming/tech videos
3. Cross-reference against AICU database (5,864 users)
4. Select 100 users, run keyword analysis
5. Write a before/after domain comparison report

**Expected:** Gaming discourse should show higher attack, lower cooperation than history. Tech should show more evidence/correction. If axes shift predictably across domains, model is robust.

**Commands:**
```bash
# Scrape new seed (if task mining system is used)
node server/scripts/mineSeedVideos.js --seed 游戏 --maxVideos 5

# Then browser-harness UID extraction (see .claude/collect_uids.py pattern)
# Then analysis (see .claude/analyze_100_users.js)
```

### 2b. Expand Sparse Axes via DeepSeek

**Problem:** Evasion (1.2%), correction (0.6%), evidence (2.2%) are all thin. 8% of users activate correction, 18% evasion.

**Steps:**
1. For each sparse family (evasion, correction, evidence), prompt DeepSeek to generate 20–40 new Chinese Bilibili-specific terms with aliases, examples, and risk levels
2. Curate output — remove duplicates, verify Chinese authenticity
3. Merge into dictionary shards (`server/data/deepseekKeywordDictionary.entries/<family>-*.json`)
4. Regenerate combined entries
5. Rerun 100-user analysis on existing data
6. Write before/after report

**Expected outcome:**
| Axis | Before | After Target |
|------|--------|-------------|
| evasion | 1.2% (18 users) | ~5% (30+ users) |
| correction | 0.6% (8 users) | ~3% (20+ users) |
| evidence | 2.2% (27 users) | ~8% (40+ users) |

**Commands:**
```bash
# Use DeepSeek to generate terms (see server/scripts/generateTerms.js pattern)
# Then merge:
node server/mergeAgentDictionaries.js <new-terms-dir>
npm run dictionary:coverage
```

### 2c. Commit and Push

**Working tree has accumulated:**
- Dictionary entry shards (attack, absolutes, cooperation, correction, evasion, evidence)
- Evidence shard files
- README + stats updates
- New analysis scripts and reports in `.claude/`

```bash
git add server/data/deepseekKeywordDictionary.*/
git add docs/stats/
git add README.md
git add .claude/personality_analysis_report_100.md .claude/personality_analysis_data_100.json
git add .claude/MASTER_PLAN.md .claude/deferred_plans.md
git commit -m "feat: 100-user model validation + dictionary harvest results"
git push
```

---

## Phase 3 — Transform the Codespace (~3–5 hours)

### 3a. Python Migration — Complete the Architecture Shift

**Goal:** Move data-heavy work from JS to Python per the project's architecture direction. JavaScript keeps app/API orchestration; Python owns corpus, coverage, scraping-plan, verification, and analyzer compatibility.

**Steps:**
1. Run `npm run python:migration-inventory` to see the full backlog and current gates
2. For each remaining module:
   - Migrate logic from `server/` JS to `python_backend/` Python
   - Run `npm run python:compare` to verify parity
   - Once parity proven, retire the JS path
3. Priority order: analyzers → coverage → harvest → scraping plans
4. Run `npm run python:test` after each migration
5. Run `npm test` to ensure JS side still passes

**Key commands:**
```bash
npm run python:migration-inventory   # Current backlog and gates
npm run python:compare               # JS vs Python contract outputs
npm run python:verify-random         # Random evidence verification
npm run python:test                  # All Python tests
python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method  # Single test
```

**Pattern (compare-before-replace):**
1. Read JS implementation in `server/services/` or `server/scripts/`
2. Write Python equivalent in `python_backend/cli/`
3. Run comparator: `node server/scripts/compare*.js`
4. If outputs match → retire JS path
5. If mismatch → debug and retry

**Estimated runtime:** ~2–4 hours depending on backlog size. Each module 30 min–2 hours.

**Risk:** Parity bugs. Preserve JS behavior during migration. Always run comparators before retiring JS.

---

## Quick Reference

| Command | What |
|---------|------|
| `npm run dictionary:coverage` | Coverage audit |
| `npm run dictionary:prune-exhausted` | Remove deadwood terms |
| `npm run dictionary:auto` | Full auto-coverage harvest loop |
| `npm run stats:update` | Refresh README stats + SVGs |
| `npm test` | All JS tests |
| `npm run python:test` | All Python tests |
| `npm run python:compare` | JS vs Python parity check |
| `npm run python:migration-inventory` | Migration backlog |
| `node server/scripts/mineSeedVideos.js --seed <tag>` | Scrape new seed videos |
