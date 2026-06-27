# Implementation Audit Report

> 2026-06-27. Systematic verification of all claimed implementations from recent sessions.
> Verdict: 13/13 claimed fixes/features confirmed real. 3 quality issues found.

---

## Audit Results

### ✅ Fully Implemented & Verified

| # | Claim | File:Line | Evidence |
|---|-------|-----------|----------|
| 1 | `handlePublicSearch` → `fetchUidComments` | `src/main.jsx:1139` | `onAnalyze={fetchUidComments}`, no reference to old name |
| 2 | `fetchUidComments` accepts `uid` param | `src/main.jsx:999` | `const fetchUidComments = async (uid) =>` |
| 3 | `perThousand` missing arg fix | `src/main.jsx:590` | `perThousand(riskLexiconText, runtimeLexicon.absolutes)` — both args |
| 4 | `countMatches` defensive guard | `src/main.jsx:316-317` | `if (!Array.isArray(terms)) return 0;` |
| 5 | `getTrollIndex` defensive guard | `src/main.jsx:503-507` | `!Array.isArray(user.scores)` check + error log |
| 6 | Dynamic UID extract utility | `src/utils/extractUid.js` | 84 lines, full impl, 8 input formats supported |
| 7 | Dynamic UID tests | `src/utils/extractUid.test.js` | 21 tests, all pass, 12+ input formats covered |
| 8 | SearchBox integrated with extractUid | `src/components/SearchBox.jsx:3,10` | imports + `extractUid(query)` in handleSubmit |
| 9 | SearchBox placeholder updated | `src/components/SearchBox.jsx:22` | `"输入 B 站 UID 或用户空间链接，例如..."` |
| 10 | Semantic-match endpoint wired | `server/routes/deepseek.js:43-77` | Returns 200, `{ok:true, matches:[...]}` verified via curl |
| 11 | 50-line cap lifted to 200 | `src/main.jsx:1073` | `.slice(0, 200)` with comment |
| 12 | analyze-comments deferral documented | `src/main.jsx:1000-1007` | 4-line rationale comment |
| 13 | analyze-comments deferral documented | `server/routes/deepseek.js:21-28` | 4 documented blockers + path forward |

### ⚠️ Quality Issues Found

| # | Issue | Detail | Fix |
|---|-------|--------|-----|
| Q1 | `_telemetry` not observable | Code at `server/routes/deepseek.js:62-75` but server process was started before the change. Response has no `_telemetry` key. | Restart server |
| Q2 | Semantic match threshold too low | `DEFAULT_THRESHOLD = 0.65` in `semanticMatcher.js:9`. For UID 12926982, produced 13,650 matches across 75/140 lines — vast majority are false positives. Example: "我650w电源实在不想换了" matched "别急", "上条作废", "百分百" (all wrong). | Raise to 0.70–0.75 |
| Q3 | Auto-harvest didn't touch sparse families | Dictionary grew 30 terms (+19 attack, +7 absolutes, +4 cooperation). **Zero new terms** for evasion (93), evidence (57), correction (54) — the three families that most need expansion. | Targeted DeepSeek generation per MASTER_PLAN Phase 2b |

### 📋 Correctly Deferred (Not Bugs)

| # | Item | Rationale |
|---|------|-----------|
| D1 | Per-comment AI analysis | Axis mismatch (6 vs 4), 30-sentence cap, cost/latency, sync pipeline restructure needed |
| D2 | `fetchUidComments` regex fallback | SearchBox pre-validates UID; regex in fetchUidComments is redundant but harmless |
| D3 | Dual system (public + admin) | Plan exists, needs scoping |
| D4 | 500-comment labeled dataset | Phase 2 of scientific plan, needs data collection |

### 🐛 Pre-Existing Test Failures (Not Caused by Our Changes)

5 semantic matcher test failures (`chunks.map is not a function`). English model on Chinese text. Plan in `.claude/SEMANTIC_SEARCH_PLAN.md`. Was failing before this session.

**Full suite:** 1342 tests, 1337 pass, 5 fail (same 5 as before).

---

## Timeline

| Session | What | Real? |
|---------|------|-------|
| Earlier (compacted) | 3 frontend bug fixes + 2 defensive guards | ✅ All verified |
| Earlier (compacted) | Dynamic UID search plan written | ✅ Plan written |
| Between sessions | Dynamic UID search IMPLEMENTED | ✅ Extracts, tests, SearchBox, placeholder — all done |
| This session | Semantic-match endpoint wired | ✅ Returns 200 with matches |
| This session | 50→200 line limit | ✅ Verified in source |
| This session | analyze-comments deferred | ✅ Documented with rationale |
| This session | Dictionary auto-harvest | ⚠️ Ran but missed sparse families |
| This session | `_telemetry` added to route | ⚠️ Code written, server needs restart |

---

## Summary

**13/13 claimed implementations are real.** The dynamic UID search — which was listed as "planned, not implemented" in the summary — was actually fully implemented between sessions (utility, tests, SearchBox integration, placeholder). Nothing is a stub or placeholder.

**3 quality issues** need attention: raise semantic match threshold, restart server for telemetry, targeted DeepSeek term generation for sparse dictionary families.
