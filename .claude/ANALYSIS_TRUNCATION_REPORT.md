# Analysis Truncation Diagnostic Report — UID 12926982

> 2026-06-27. Investigates why 140 fetched comments appear to produce only a small
> number of analyzed results.

---

## 1. Raw Data Verification

```
UID: 12926982
Comments fetched:  60   (from AICU API, 3 pages × 20)
Danmaku fetched:   80   (from AICU API, 4 pages × 20)
Total entries:     140
combinedText:      2089 chars
Lines after split: 140  (splitComments splits by /\n+/, each entry = 1 line)
```

**Confirmed:** All 140 entries are present in `combinedText` and are passed to
the scoring pipeline as 140 separate lines.

---

## 2. Pipeline Trace

The full analysis path for the main search flow:

```
User types UID → SearchBox → fetchUidComments(uid)
  ├─ POST /api/aicu/scrape        → fetches all 140 entries  ✓
  ├─ POST /api/deepseek/train-keywords → extracts keywords (text trunc 6000 chars)
  ├─ POST /api/deepseek/semantic-match → semantic enrichment (first 50 lines; ⚠ 404)
  └─ scoreComments(text)          → client-side scoring      ✓
       ├─ splitComments(text)      → 140 elements            ✓
       ├─ classifySpeechAct()      → iterates ALL 140         ✓
       ├─ findLexiconMarks()       → iterates ALL 140         ✓
       ├─ mergeSemanticMatches()   → only 50 lines if API worked
       └─ summarizeVocabularyMarks → aggregates all matches
```

### 2a. Client-side scoring — ALL comments processed

`scoreComments()` at `src/main.jsx:556` splits the full text by newlines (`/\n+/`)
into 140 elements. Every element is processed by:
- `classifySpeechAct(comment, index, total)` — speech-act rule engine
- `findLexiconMarks(comment, index, total, runtimeLexicon)` — keyword matcher
- Density/perThousand calculations use all 140 as the denominator

`selectedUser.analyzed` = `comments.length` = **140**. This is the "有效评论"
metric displayed in the UI.

### 2b. Keyword matching — limited coverage

```
Dictionary:  1,639 terms across 6 families
Coverage:    34 / 140 lines (24%) have ANY keyword match
Risk matches: 14 marks across ~13 lines (attack: 6, absolutes: 8)
```

29 unique vocabulary marks (chips) would appear in the UI. The user likely
sees either:
- The number of **vocabulary chips** (~29), or
- The number of **risk-polarity chips** (~14), or
- The **"高风险话语"** count (negative speech acts), or
- The **"词库辅助证据"** count (lexicon marks)

None of these equal "comments analyzed" — they represent **keyword coverage**,
not how many comments were fed into the analysis engine.

### 2c. Per-family breakdown for UID 12926982

| Family | Matches | Lines | Dictionary Terms |
|--------|---------|-------|-----------------|
| attack | 6 | 6/140 | 966 |
| evasion | 0 | 0/140 | 93 |
| absolutes | 8 | 7/140 | 123 |
| evidence | 2 | 2/140 | 57 |
| cooperation | 27 | 24/140 | 346 |
| correction | 1 | 1/140 | 54 |
| **Any** | **—** | **34/140** | **1,639** |

---

## 3. Truncation & Sampling Points Found

### 3a. Semantic matching — first 50 lines only (CRITICAL)

**Location:** `src/main.jsx:1064`
```js
const commentLines = nextCommentText.split(/\r?\n/).filter(Boolean).slice(0, 50);
```

Only the first 50 lines are sent to `/api/deepseek/semantic-match`. Lines 51–140
get no semantic enrichment. **Additionally, this endpoint does not exist in the
router** — it returns 404. The error is caught silently:
```js
console.warn('Semantic matching unavailable, using exact match only:', semError.message);
```

**Impact:** Semantic match enrichment is completely non-functional. Analysis
falls back to exact keyword matches only. No AI-powered semantic similarity
lookup happens.

### 3b. DeepSeek keyword extraction — 6000 character truncation

**Location:** `server/services/deepseekKeywordTrainer.js:3722`
```js
${String(text || '').slice(0, 6000)}
```

The full `combinedText` is sent, but the prompt template truncates to 6000 chars.
For UID 12926982, the text is only 2089 chars — no truncation occurs here. But
for users with longer comments (~70+ chars average), this would clip content.

### 3c. DeepSeek standalone analysis — 30 sentences max

**Location:** `server/services/deepseekKeywordTrainer.js:4174`
```js
comments: splitAnalysisSourceSentences(payload.text).slice(0, compact ? 15 : 30),
```

The `/api/deepseek/analyze-comments` endpoint (standalone AI analysis) only sees
30 sentences (15 in compact/retry mode). However, this endpoint is **not called**
from the main search flow — it's only available as a separate API.

### 3d. `splitAnalysisSourceSentences` deduplication

**Location:** `server/services/deepseekKeywordTrainer.js:885-892`
```js
function splitAnalysisSourceSentences(text) {
  return unique(
    String(text || '')
      .split(/[\r\n]+/)
      .flatMap((line) => String(line || '').split(/(?<=[。！？!?;；])/u))
      .map((line) => line.trim())
      .filter(Boolean),
  );
}
```

Uses `unique()` to deduplicate identical sentences. For repetitive content
(e.g., multiple "催更" or "[tv_点赞]" entries), this can significantly reduce
the effective sample size before it reaches the AI analysis endpoints.

---

## 4. Root Cause Answer

**Q: "Is the current model really analyzing all 140 comments, or just a few examples?"**

**A: All 140 comments ARE processed by the core analysis pipeline.** Every
comment line goes through:
1. Keyword matching against 1,639 dictionary terms
2. Speech-act classification (rule-based, not AI)

**However**, the user sees a small result number (~9–29) because:
1. **Keyword coverage is low** (34/140 lines match any term; risk families
   match only ~13 lines). The dictionary has 1,639 terms but most are attack
   terms (966) that don't match this user's comment style.
2. **Semantic matching is broken** (endpoint returns 404). AI-powered semantic
   similarity lookup that could augment keyword matches is non-functional.
3. **There is no per-comment AI analysis in the main flow.** Comments are not
   individually analyzed by DeepSeek for speech acts, stance, or intent. The
   pipeline relies on keyword matching + rule-based speech act classification.
4. **The `vocabularyMarks` count or `speechSummary.lexicon` metric** (showing
   ~29 vocabulary chips or ~14 risk marks) is misinterpreted as "comments
   analyzed" when it actually represents "keyword matches found."

---

## 5. Resolution (2026-06-27)

### ✅ 1. Semantic-match endpoint — WIRED
The endpoint already existed at `POST /api/deepseek/semantic-match` (added in
`ce31f966`). Verified working: returns `{ok: true, matches: [...], _telemetry: {...}}`.
Added telemetry fields (`commentsTotal`, `commentsWithMatches`, `hitRate`,
`timingMs`) for observability.

**Quality caveat:** The `@xenova/transformers` `multilingual-e5-small` model
produces noisy matches for short Chinese comments. Matches with score < 0.70
should be treated as weak hints, not evidence. The frontend already applies
lower confidence to semantic matches (0.54–0.58 × similarity score).

### ✅ 2. 50-line limit — LIFTED
Changed `src/main.jsx:1073`: `.slice(0, 200)` replaces `.slice(0, 50)`.
Cap at 200 keeps the embedding batch size reasonable while covering typical
UIDs (most have < 200 comment lines).

### 🔄 3. Dictionary auto-harvest — RUNNING
`npm run dictionary:auto` launched as background task. Uses
`deepseek-v4-flash` with `reasoningEffort=max` for keyword discovery.
Focus families: evasion (93 terms), evidence (57 terms), correction (54 terms).

### 📋 4. `/api/deepseek/analyze-comments` — DEFERRED
**Decision:** Not wired into the main UID search flow. Rationale:

| Blocker | Detail |
|---------|--------|
| **Axis mismatch** | Endpoint uses 6-axis system (对抗性动机, 认知闭合, 证据敏感, 逻辑一致, 合作讨论, 修正意愿). Main UI uses Ziegenbein 4-axis (情绪过激, 回避讨论, 逻辑混乱, 其他问题). Mapping between systems would be lossy. |
| **30-sentence cap** | `buildStandaloneAnalysisInput` at L4174 hard-caps to 30 sentences (15 compact). For UID 12926982 with 140 comments, only ~21% would get AI analysis. Batching would multiply API cost. |
| **Model downgrade** | Forced to `deepseek-v4-flash` for analysis calls (v4-pro reasoning consumes too many tokens for 6-axis JSON output). Training still uses v4-pro. |
| **Sync pipeline** | `scoreComments()` is synchronous client-side. Adding async AI calls requires restructuring the analysis flow with loading states, partial results, and error recovery. |
| **Cost/latency** | Each call ≈ 5–15s + API credits. For typical 100-comment UIDs, batching into 4+ calls would add 20–60s latency. |

**Path to future integration:**
1. Align the axis system (either migrate UI to 6-axis or endpoint to 4-axis)
2. Implement chunked/batched analysis with per-chunk streaming
3. Add progressive UI: show rule-based results immediately, enhance with AI as it arrives
4. Set a per-UID cost budget (e.g., max 5 API calls)

---

## 6. Summary

| Aspect | Status |
|--------|--------|
| All comments processed by keyword matcher | ✅ Working (140/140) |
| All comments processed by speech act classifier | ✅ Working (140/140) |
| Semantic match enrichment | ✅ Wired (ce31f966), 200-line cap, telemetry added |
| AI keyword extraction coverage | ⚠️ Truncated to 6000 chars (OK for this UID) |
| Per-comment AI speech-act analysis | 📋 Deferred (axis mismatch, 30-sentence cap, cost) |
| Dictionary coverage for this user | 🔄 Auto-harvest running; focus on evasion/evidence/correction |
| 50-line semantic match limit | ✅ Lifted to 200 (covers all typical UIDs) |
