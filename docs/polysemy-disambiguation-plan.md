# Chinese Polysemy Disambiguation — Implementation Plan

## Problem Statement

In Chinese, a single term can carry multiple meanings depending on context/scenario. The current dictionary and matching pipeline are **sense-blind** — one term maps to one meaning, one embedding, one family. This causes:

- **False positives**: "急了" in "别急了我马上到" (reassurance) flagged as attack
- **Cross-family conflicts**: "绷不住了" exists in BOTH `attack-004.json` AND `cooperation-002.json` with different risk levels
- **Whack-a-mole maintenance**: 40+ ad-hoc `is*Context()` suppression functions in `commentCoverage.js` created reactively after each audit round

## Current Architecture (Baseline)

| Layer | File | Mechanism | Polysemy-Aware? |
|---|---|---|---|
| Exact substring | `src/main.jsx:376-406` | `comment.includes(term)` | No |
| Semantic embedding | `server/services/semanticMatcher.js:83-134` | One vector per `"${term}: ${meaning}"` | No |
| Comment coverage FP suppression | `server/services/commentCoverage.js:2704-2745` | 40+ hand-written regex functions | Partial — only suppresses, never disambiguates |
| Meme/quote detection | `src/languageUnderstanding.js:89-128` | `isMemeOrQuotedNonAttackText()` | Coarse filter only |

### Concrete Failure Examples

1. **绷不住了** — two competing entries: `attack-004.json` (risk=medium) vs `cooperation-002.json` (risk=positive). Semantic matcher picks whichever embedding has higher cosine similarity — arbitrary.
2. **急了** — single entry (attack/medium), but real usage spans: taunting ("你急了哈哈哈"), neutral urgency ("别急了我马上到"), descriptive ("市场急了").
3. **逆天** — captured only as attack, but "这操作逆天" is positive praise in gaming contexts.
4. **典中典** — captured only as attack, but can mean "textbook example" (neutral) in educational contexts.

---

## Phased Plan

### Phase 1: Multi-Sense Data Model (P0)

**Goal**: Allow one term to carry multiple senses, each scoped to a context.

**Schema change** — from single-sense:

```jsonc
{ "term": "急了", "family": "attack", "meaning": "...", "risk": "medium" }
```

To multi-sense:

```jsonc
{
  "term": "急了",
  "senses": [
    {
      "id": "急了-1",
      "family": "attack",
      "meaning": "嘲讽对方情绪失控，攻击性用法",
      "risk": "medium",
      "contextHints": ["你", "哈哈哈", "破防", "急眼", "典"],
      "contextAntiHints": ["别", "慢慢", "马上", "市场", "不急"],
      "scenario": "taunting"
    },
    {
      "id": "急了-2",
      "family": "cooperation",
      "meaning": "中性或关心的催促/安抚",
      "risk": "positive",
      "contextHints": ["别", "慢慢来", "不急", "马上到", "没事"],
      "scenario": "reassurance"
    }
  ],
  "defaultSense": "急了-1"
}
```

**Backward compat**: Single-sense entries auto-wrap at read time. No migration required for the 95%+ unambiguous terms.

**Files**: 14 entry shard JSONs + `deepseekKeywordTrainer.js` (reader).

### Phase 2: Per-Sense Embeddings (P0)

**Goal**: Build one embedding per sense, not per term.

**In `semanticMatcher.js:buildTermEmbeddings()`**:
- Current: `"${term}: ${meaning}"` — one per entry
- Proposed: `"${term} [${scenario}]: ${meaning} | context: ${contextHints.join(', ')}"` — one per sense
- Cache key changes from `term` → `senseId`
- Return type: `Map<senseId, Float32Array>` with metadata mapping `senseId → {term, family, risk, scenario}`

### Phase 3: Context-Weighted Sense Scoring (P1)

**Goal**: Use surrounding words in the comment chunk to weight which sense is more likely.

**New function `disambiguateSenses(matches, commentChunk)`**:

```
For each matched sense:
  1. baseScore = cosine similarity (existing pipeline)
  2. contextBonus = count(contextHints ∩ chunk words) × 0.05
  3. contextPenalty = count(contextAntiHints ∩ chunk words) × 0.10
  4. finalScore = baseScore + contextBonus - contextPenalty
Return top sense per term (max finalScore), or null if all below threshold
```

No LLM call needed — lightweight heuristic on top of existing embeddings.

### Phase 4: Comment-Level Scenario Classifier (P2)

**Goal**: Before matching, classify the comment's overall scenario to bias sense selection.

**New lightweight classifier** (`server/services/contextClassifier.js`):

```
Scenario taxonomy:
  - "taunting"       → laughing emoji, "哈哈哈", "笑死", rhetorical questions
  - "argument"       → evidence language, logical connectors, rebuttal markers
  - "praise"         → positive emoji, "牛", "强", "厉害", "太强了"
  - "neutral_info"   → plain statements, links, citations, factual tone
  - "reassurance"    → "别", "慢慢", "不急", "没事", "冷静"
  - "self_deprecation" → "我", "自己", "菜", "垃圾" (self-referential negative)
```

Scenario match with sense's `scenario` field gives a bonus multiplier (e.g., +0.08).

### Phase 5: Audit & Split Existing Polysemous Entries (P2)

**Goal**: Identify all terms with multiple meanings and migrate them.

**Process**:
1. Automated scan: group entries by `term`, flag any with entries in ≥2 families
2. Manual review of flagged terms (estimated 15–30 terms)
3. Split each into multi-sense entries with `contextHints`, `contextAntiHints`, and `scenario`
4. Remove duplicate entries after migration
5. Rebuild embeddings cache

### Phase 6: `contextRequired` Flag & Performance (P3)

**Goal**: Only pay the disambiguation cost for polysemous terms.

- Add `"contextRequired": true` only on entries with multiple senses
- Matching pipeline checks this flag — skips disambiguation for unambiguous terms
- ~95% of terms remain single-sense, zero overhead added

---

## Estimated Impact

| Metric | Before | After |
|---|---|---|
| Terms with multi-sense support | 0 | ~20–30 (polysemous subset) |
| Estimated FP rate on polysemous terms | ~35–50% | ~15–25% (target) |
| Cross-family term conflicts | 4+ confirmed | Resolved via sense disambiguation |
| Ad-hoc suppression functions | 40+ | Can deprecate ~10–15 |
| Embedding count | 1,756 | ~1,800 (+sense splits) |

---

## Files to Create/Modify

| File | Action | Phase |
|---|---|---|
| `server/data/deepseekKeywordDictionary.entries/*.json` | Add `senses[]` to polysemous entries | P1 |
| `server/services/semanticMatcher.js` | Per-sense embeddings, context-weighted scoring | P2, P3 |
| `server/services/semanticMatcher.test.js` | Tests for multi-sense embedding and disambiguation | P2, P3 |
| `server/services/deepseekKeywordTrainer.js` | Multi-sense reader with backward compat | P1 |
| `src/main.jsx` | `mergeSemanticMatches` → sense-aware merge | P3 |
| `server/services/commentCoverage.js` | Scenario classifier integration, deprecate obsoleted FP suppressions | P4 |
| `src/languageUnderstanding.js` | Feed context classification into scoring pipeline | P4 |
| `server/services/contextClassifier.js` | **New**: shared scenario classifier | P4 |
| `server/services/contextClassifier.test.js` | **New**: classifier tests | P4 |
| `python_backend/analysis/polysemy_audit.py` | **New**: automated polysemy detection script | P5 |

---

## Risk & Rollback

- **Schema change is additive** — single-sense entries unchanged; multi-sense is opt-in per term
- **Embedding cache is versioned** — `dictionaryVersion` bump forces rebuild on next run
- **Context-weighted scoring is tunable** — bonus/penalty weights are constants, easy to adjust or zero out
- **Full rollback**: revert entry JSONs + remove `disambiguateSenses` call → identical to current behavior
