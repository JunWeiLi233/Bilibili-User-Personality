# Next Steps — Bilibili User Personality

> 2026-06-27. Consolidated status after analysis truncation fix.
> All outstanding work across plans, plus current state of each.

---

## Current State

| Thing | Status |
|-------|--------|
| Frontend (search, charts, vocab chips) | ✅ Working |
| UID search (basic digit extraction) | ✅ Working |
| Dynamic UID search (links, labels, free text) | 📋 Planned, not implemented |
| API pipeline (AICU → keyword train → score) | ✅ Working |
| Semantic-match endpoint | ✅ Wired (was 404), noisy quality |
| 140-comment analysis coverage | ✅ All processed (keyword + speech act) |
| Per-comment AI analysis | 📋 Deferred (axis mismatch, cost, 30-sentence cap) |
| Dictionary — attack family | ⚠️ 966 terms, dominates |
| Dictionary — evasion family | ⚠️ 93 terms, 0% activation for UID 12926982 |
| Dictionary — evidence family | ⚠️ 57 terms, 2% activation |
| Dictionary — correction family | ⚠️ 54 terms, 1% activation |
| JS → Python migration | 🔄 In progress, backlog exists |
| Tieba cross-platform scrape | ⏸️ Paused |
| 6 semantic matcher test failures | 🐛 Known (English model on Chinese text) |
| Dual system (public + admin) | 📋 Planned |

---

## 1. Quick Wins (~5 min)

**Source:** MASTER_PLAN Phase 1

```bash
npm run dictionary:coverage        # → server/data/keywordCoverageAudit.json
npm run dictionary:prune-exhausted # remove deadwood terms
npm run stats:update               # refresh README stats + SVGs
```

Optionally:
```bash
npm run dictionary:auto            # full auto-coverage harvest loop (longer, needs DeepSeek)
```

---

## 2. Dynamic UID Search (~30 min)

**Source:** `.claude/DYNAMIC_UID_SEARCH_PLAN.md` (approved, not implemented)

| Step | File | Action |
|------|------|--------|
| 1 | `src/utils/extractUid.js` | CREATE — `extractUid(input)` → `{uid, source, confidence}` |
| 2 | `src/utils/extractUid.test.js` | CREATE — 12 test cases |
| 3 | `src/components/SearchBox.jsx` | EDIT — import `extractUid`, replace naive regex |
| 4 | `src/main.jsx:999` | EDIT — trust pre-validated UID from SearchBox |
| 5 | `src/components/SearchBox.jsx` | EDIT — update placeholder text |

Recognized formats: plain UID, `space.bilibili.com/{uid}`, `UID: xxx`, `mid xxx`, free text.
Rejected: BV/AV video IDs, short digit runs (<4 chars), empty input.

---

## 3. Expand Sparse Axes (~2h)

**Source:** MASTER_PLAN Phase 2b

| Family | Current | Target | Action |
|--------|---------|--------|--------|
| evasion | 93 terms, 1.2% activation | ~150 terms, ~5% | DeepSeek generate 20–40 new terms |
| correction | 54 terms, 0.6% activation | ~100 terms, ~3% | DeepSeek generate 20–40 new terms |
| evidence | 57 terms, 2.2% activation | ~100 terms, ~8% | DeepSeek generate 20–40 new terms |

**Commands:**
```bash
# Generate terms via DeepSeek prompt per family
# Merge into dictionary shards
node server/mergeAgentDictionaries.js <new-terms-dir>
npm run dictionary:coverage
npm run stats:update
```

---

## 4. Cross-Domain Validation (~2h)

**Source:** MASTER_PLAN Phase 2a

All 763 seed files are history-domain. Test on gaming/tech:
1. Scrape seed videos for "游戏" or "科技"
2. Extract ~500 commenter UIDs via browser-harness
3. Cross-reference AICU database (5,864 users)
4. Select 100 users, run keyword analysis
5. Write before/after domain comparison report

**Expected:** Gaming → higher attack, lower cooperation. Tech → more evidence/correction.

---

## 5. Commit & Push Accumulated Work

**Source:** MASTER_PLAN Phase 2c

Working tree has: dictionary shards, evidence files, reports, analysis scripts.

```bash
git add server/data/deepseekKeywordDictionary.*/
git add docs/stats/
git add README.md
git add .claude/personality_analysis_report_100.md .claude/personality_analysis_data_100.json
git add .claude/MASTER_PLAN.md .claude/NEXT_STEPS.md
git commit -m "feat: 100-user model validation + dictionary harvest + analysis truncation fix"
```

---

## 6. Python Migration (~3–5h)

**Source:** MASTER_PLAN Phase 3a

JS keeps app/API orchestration. Python owns corpus, coverage, scraping, verification.
Priority: analyzers → coverage → harvest → scraping plans.

```bash
npm run python:migration-inventory   # current backlog + gates
npm run python:compare               # JS vs Python parity
npm run python:verify-random         # random evidence verification
npm run python:test                  # all Python tests
```

Pattern: read JS → write Python → compare outputs → retire JS path.

---

## 7. Tieba Cross-Platform Scrape (~2–3h)

**Source:** MASTER_PLAN Phase 3b

Harvest evidence from Baidu Tieba (more debate-heavy discourse):
1. Edit `.claude/tasks/tieba_scrape.json` → `"active": true`
2. Run: `node server/scripts/runTiebaKeywordScrape.js`
3. Set `TIEBA_TRAIN_DICTIONARY=1`
4. After: `npm run dictionary:coverage` + `npm run stats:update`

**Risk:** CAPTCHAs, IP blocks.

---

## 8. Deferred / Future

| Item | Why Deferred |
|------|-------------|
| Per-comment AI analysis | Axis mismatch (6 vs 4), 30-sentence cap, cost, sync pipeline restructuring |
| Dual system (public + admin) | Plan in `.claude/DUAL_SYSTEM_PLAN.md`, needs scoping |
| Scientific 500-comment dataset | Phase 2 of scientific plan, needs labeled data |
| 6 semantic matcher test failures | English model on Chinese text, plan in `.claude/SEMANTIC_SEARCH_PLAN.md` |
| 9 tech debts from debug handoff | Not yet triaged |
| Semantic match noise filter | Server-side `score >= 0.70` threshold before returning matches |

---

## Recommended Order

1. **Quick Wins** — 5 min, no risk, cleans up dictionary
2. **Dynamic UID Search** — 30 min, approved plan, user-facing improvement
3. **Expand Sparse Axes** — 2h, directly fixes the "9 comments" perception (more terms = more matches)
4. **Commit & Push** — lock in progress
5. **Cross-Domain Validation** — 2h, proves model robustness
6. **Python Migration** — incrementally, module by module
7. **Tieba Scrape** — when dictionary needs more diverse evidence
