# Plan: Word Relationship Analysis — Hybrid Cascade

**Status**: Not started | **Estimate**: ~8 hrs total (phased) | **Source**: `/autoresearch:reason` protocol, unanimous convergence

## Problem

The Bilibili comment analyzer matches 1,726 dictionary keywords individually. Each keyword is scored in isolation — there is zero modeling of how words relate to each other. This causes:

- **Overcounting attacks**: Each hostile word counted independently in the same sentence
- **Missing negations**: "不是他傻" → "不是" and "傻" matched separately, no recognition that "不是" negates "傻"
- **No intensifier coupling**: "完全就是垃圾" → three independent matches instead of one intensified attack
- **No target-accusation binding**: "策划" + "垃圾" = attack, but "策划" + "辛苦了" ≠ attack — system can't tell the difference

The polysemy eval (48 test cases) revealed that the current disambiguator (regex patterns per single term) hits a ceiling at ~83-93% accuracy because it cannot model cross-term relationships.

## Solution: Three-Tier Hybrid Cascade

```
Comment text → [Tier 1: Composite Patterns] → [Tier 2: Co-occurrence PMI] → [Tier 3: LLM Fallback] → applyDisambiguation()
```

Each tier handles cases the previous tier couldn't resolve confidently. Graceful degradation: if any tier fails, earlier tiers still work.

## Phase 1: Composite Pattern Matching (Tier 1) — ~2 hrs

### Step 1a: Add composite rule support to disambiguator — 45 min

Add a new `"composite"` rule type to `disambiguation_rules.json` that matches MULTIPLE terms simultaneously:

```json
{
  "composites": [
    {
      "id": "comp-001",
      "terms": ["不是", "就是"],
      "description": "不是X就是Y — binary absolutist framing, confirm both",
      "pattern": "不是[^，。！？…]{0,20}就是",
      "action": "confirm",
      "confidence": 0.85,
      "applyTo": "all"
    },
    {
      "id": "comp-002",
      "terms": ["不是", "而是"],
      "description": "不是X而是Y — corrective, suppress 不是's attack signal",
      "pattern": "不是[^，。！？…]{0,25}而是",
      "action": "suppress",
      "confidence": 0.88,
      "applyTo": ["不是"]
    },
    {
      "id": "comp-003",
      "terms": ["没有", "那么"],
      "description": "没有X那么Y — comparative, not absolute negation",
      "pattern": "没有[^，。！？…]{0,15}那么",
      "action": "suppress",
      "confidence": 0.82,
      "applyTo": ["没有"]
    }
  ]
}
```

Modify `disambiguateTerm()` to check composites FIRST before single-term rules:

```javascript
// In disambiguator.js — add composite check before single-term rules
export function disambiguateTerm(text, term, family) {
  const allRules = loadRules();
  
  // NEW: Check composite patterns first (they take precedence)
  const composites = allRules.composites || [];
  for (const comp of composites) {
    if (!comp.terms.includes(term)) continue;
    try {
      const re = new RegExp(comp.pattern, 'u');
      if (re.test(text)) {
        return {
          term,
          family,
          action: comp.applyTo === 'all' || comp.applyTo.includes(term) ? comp.action : 'neutral',
          reason: `composite:${comp.id}`,
          confidence: comp.confidence,
          description: comp.description,
        };
      }
    } catch (e) { /* skip invalid */ }
  }
  
  // Fall through to existing single-term rules...
}
```

### Step 1b: Author ~50 high-impact composite patterns — 45 min

Priority pairs (ordered by impact, derived from dictionary term families):

| # | Composite | Pattern | Action | Why |
|---|---|---|---|---|
| 1 | 不是...就是 | `不是[^，。！？…]{0,20}就是` | confirm both | Binary absolutist framing |
| 2 | 不是...而是 | `不是[^，。！？…]{0,25}而是` | suppress 不是 | Corrective, not attack |
| 3 | 没有...那么 | `没有[^，。！？…]{0,15}那么` | suppress 没有 | Comparative |
| 4 | 可能...完全 | `可能[^，。！？…]{0,20}(?:完全|根本|绝对)` | confirm 可能 | Disguised absolute |
| 5 | 都是...的错 | `都是[^，。！？…]{0,15}(?:的错|的问题|害的)` | confirm 都是 | Blame attribution |
| 6 | 肯定...不 | `肯定[^，。！？…]{0,8}不` | suppress 肯定 | Negated certainty |
| 7 | 为什么...不 | `为什么[^，。！？…]{0,20}不` | confirm 为什么 | Rhetorical accusation |
| 8 | 确实...典/绷 | `确实[，,]?[^，。！？…]{0,15}(?:典|绷|乐)` | confirm 确实 | Sarcastic confirmation |
| 9 | 笑死...你/他 | `笑死[，,]?[^，。！？…]{0,15}(?:你|他|她)` | confirm 笑死 | Targeted mockery |
| 10 | 一句话...就 | `一句话[，,:：]?[^，。！？…]{0,25}就` | confirm 一句话 | Conclusive assertion |
| 11 | 觉得...不 | `觉得[^，。！？…]{0,15}不` | neutral 觉得 | Negative opinion, not attack |
| 12 | 没有...什么 | `没有[^，。！？…]{0,8}什么` | suppress 没有 | Existential, not absolute |
| 13 | 根本...不 | `根本[^，。！？…]{0,8}不` | suppress 根本 | Negated absolute |
| 14 | 完全...不 | `完全[^，。！？…]{0,8}不` | suppress 完全 | Negated absolute |
| 15 | 一定...不 | `一定[^，。！？…]{0,8}不` | suppress 一定 | Negated absolute |

Continue for remaining families: attack-attack pairs, absolutes-evasion pairs, attack-evasion pairs, etc. Target: 50 patterns.

### Step 1c: Add eval cases for composites — 20 min

Add 12 composite-specific test cases to `evalPolysemy.js`:

```javascript
// Composite pattern test cases
{ label: 'comp-001', term: '不是', family: 'attack',
  text: '不是他傻就是策划蠢，反正不是我的问题',
  expected: 'confirm', explanation: '不是...就是 binary framing → confirm' },
{ label: 'comp-002', term: '不是', family: 'attack',
  text: '不是玩家的问题，而是策划根本没测试',
  expected: 'suppress', explanation: '不是...而是 corrective → suppress' },
// ... 10 more
```

### Step 1d: Validate — 10 min

```bash
node --test server/services/disambiguator.test.js
node server/scripts/evalPolysemy.js
# Target: correct ≥ 88% (up from 83.3%), composite patterns firing on ≥30% of cases
```

## Phase 2: Statistical Co-occurrence Model (Tier 2) — ~4 hrs

### Step 2a: Build corpus preprocessing script — 60 min

Create `server/scripts/buildCooccurrenceModel.js`:

```javascript
/**
 * Extract term co-occurrence statistics from the scored comment corpus.
 * 
 * Input: Scored comments from the annotation pipeline (corpus/*.json)
 * Output: server/data/termCooccurrence.json — PMI matrix per family
 * 
 * PMI(a,b) = log( P(a,b) / (P(a) * P(b)) )
 * Computed separately for high-risk and low-risk contexts.
 */

// 1. Load all scored comments from corpus
// 2. For each comment, extract all matched terms within a 25-char sliding window
// 3. Count: P(a), P(b), P(a,b) separately for:
//    - High-risk context (comment risk score ≥ 0.5)
//    - Low-risk context (comment risk score < 0.5)
// 4. Compute PMI for each pair in each context
// 5. Compute ΔPMI = PMI_high_risk - PMI_low_risk
//    Positive ΔPMI → pair signals argumentative context
//    Negative ΔPMI → pair signals neutral context
// 6. Output: { pairs: { "不是::就是": { highRiskPMI: 2.1, lowRiskPMI: 0.3, deltaPMI: 1.8 }, ... } }
```

### Step 2b: Implement termCooccurrence.js module — 90 min

```javascript
// server/services/termCooccurrence.js

import { readFileSync } from 'node:fs';

let _modelCache = null;

export function loadCooccurrenceModel(modelPath) {
  if (_modelCache) return _modelCache;
  const path = modelPath || join(PROJECT_ROOT, 'data', 'termCooccurrence.json');
  _modelCache = JSON.parse(readFileSync(path, 'utf8'));
  return _modelCache;
}

/**
 * Score term relationships in a comment using PMI co-occurrence model.
 * 
 * @param {string[]} matchedTerms - terms found in the comment
 * @param {string} commentText - full comment text
 * @returns {Map<string, {deltaPMI: number, confidence: number}>} term → adjustment
 */
export function scoreTermRelationships(matchedTerms, commentText) {
  const model = loadCooccurrenceModel();
  const adjustments = new Map();
  
  // Initialize all terms with no adjustment
  for (const term of matchedTerms) {
    adjustments.set(term, { deltaPMI: 0, confidence: 0, pairCount: 0 });
  }
  
  // Check all pairs within window
  const WINDOW = 25;
  for (let i = 0; i < matchedTerms.length; i++) {
    for (let j = i + 1; j < matchedTerms.length; j++) {
      const a = matchedTerms[i];
      const b = matchedTerms[j];
      
      // Check if terms are within window in the actual text
      const aPos = commentText.indexOf(a);
      const bPos = commentText.indexOf(b);
      if (Math.abs(aPos - bPos) > WINDOW) continue;
      
      // Look up PMI
      const pairKey = `${a}::${b}`;
      const reverseKey = `${b}::${a}`;
      const pairData = model.pairs[pairKey] || model.pairs[reverseKey];
      if (!pairData) continue;
      
      // Accumulate adjustment for both terms
      for (const term of [a, b]) {
        const adj = adjustments.get(term);
        adj.deltaPMI += pairData.deltaPMI;
        adj.pairCount++;
        adj.confidence = Math.min(0.85, adj.pairCount / 5); // confidence grows with pair count
      }
    }
  }
  
  // Normalize: average deltaPMI per term
  for (const [term, adj] of adjustments) {
    if (adj.pairCount > 0) {
      adj.deltaPMI = adj.deltaPMI / adj.pairCount;
    }
  }
  
  return adjustments;
}

/**
 * Apply co-occurrence adjustments to keyword weights.
 * Positive deltaPMI → boost weight (terms co-occur in argumentative contexts)
 * Negative deltaPMI → reduce weight (terms co-occur in neutral contexts)
 */
export function applyCooccurrenceAdjustments(keywordMatches, adjustments) {
  return keywordMatches.map(match => {
    const adj = adjustments.get(match.term);
    if (!adj || adj.confidence < 0.3) return match; // insufficient data
    
    const weightAdjustment = adj.deltaPMI * adj.confidence * 0.15; // max ±15% adjustment
    const newWeight = Math.max(0.1, Math.min(2.0, (match.weight || 1) * (1 + weightAdjustment)));
    
    return {
      ...match,
      weight: Math.round(newWeight * 100) / 100,
      cooccurrenceAdjustment: Math.round(weightAdjustment * 100) / 100,
      cooccurrenceConfidence: adj.confidence,
    };
  });
}
```

### Step 2c: Wire Tier 2 into commentCoverage.js — 45 min

```javascript
// In commentCoverage.js, after Tier 1 (pattern disambiguation):

import { scoreTermRelationships, applyCooccurrenceAdjustments } from './termCooccurrence.js';

const ENABLE_COOCCURRENCE = process.env.BILIBILI_COOCCURRENCE !== '0';

if (ENABLE_COOCCURRENCE && lexicalHits.length >= 2) {
  try {
    const termList = lexicalHits.map(h => h.term);
    const adjustments = scoreTermRelationships(termList, attributableMessage);
    lexicalHits = applyCooccurrenceAdjustments(lexicalHits, adjustments);
    cooccurrenceApplied = true;
  } catch (e) {
    // Fallback: keep unadjusted hits
  }
}
```

### Step 2d: Build initial PMI model from corpus — 30 min

```bash
node server/scripts/buildCooccurrenceModel.js
# Expected: PMI matrix covering ~500 term pairs with sufficient data
npm run dictionary:coverage  # verify no regression
```

### Step 2e: Validate — 15 min

```bash
node --test server/services/termCooccurrence.test.js  # new tests
node server/scripts/evalPolysemy.js
# Target: correct ≥ 91% (up from 88%), co-occurrence adjustments applied to ≥50% of cases
```

## Phase 3: LLM Fallback (Tier 3) — ~2 hrs

### Step 3a: Add DeepSeek relationship analysis prompt — 45 min

```javascript
// In server/services/deepseekKeywordTrainer.js (or new module):

const RELATIONSHIP_ANALYSIS_PROMPT = `分析以下B站评论中关键词之间的关系。对于每个匹配的关键词对，判断它们之间的关系类型：

评论：{commentText}
匹配的关键词：{matchedTerms}

对每一对在15字以内的关键词，分析：
1. 关系类型：negation（否定）, intensification（加强）, target_binding（目标绑定）, contrast（对比）, independent（独立无关）
2. 对攻击性评分的影响：boost（增强）, suppress（抑制）, neutral（无影响）
3. 置信度：0.0-1.0

返回JSON：{"relationships": [{"pair": ["termA", "termB"], "type": "...", "effect": "...", "confidence": 0.X}]}`;

export async function analyzeTermRelationships(commentText, matchedTerms) {
  // Only call when Tiers 1+2 have low confidence
  // Uses existing DeepSeek API infrastructure
}
```

### Step 3b: Wire Tier 3 fallback — 30 min

```javascript
const ENABLE_LLM_RELATIONS = process.env.BILIBILI_LLM_RELATIONS === '1'; // opt-in

if (ENABLE_LLM_RELATIONS && lowConfidenceHits.length > 0) {
  try {
    const relationships = await analyzeTermRelationships(message, lowConfidenceHits.map(h => h.term));
    lexicalHits = applyRelationshipAdjustments(lexicalHits, relationships);
  } catch (e) {
    // Fallback: keep unadjusted hits (API errors are non-fatal)
  }
}
```

### Step 3c: Validate — 15 min

```bash
# Manual testing with known edge cases
node server/scripts/evalPolysemy.js
```

## Success Criteria

| Metric | Current | Phase 1 Target | Phase 2 Target | Phase 3 Target |
|---|---|---|---|---|
| Terms with relationship context | 0% | ≥30% | ≥70% | ≥90% |
| Polysemy eval accuracy | 83.3% | ≥88% | ≥91% | ≥93% |
| False positive attack rate | baseline | -15% | -35% | -45% |
| Processing overhead per comment | 0ms | <1ms | <5ms | <50ms (API calls) |
| Disambiguator tests passing | 40 | 40 | 40+ | 40+ |

## Files to Create

- `server/services/termCooccurrence.js` — Tier 2 co-occurrence model
- `server/services/termCooccurrence.test.js` — Tier 2 tests
- `server/scripts/buildCooccurrenceModel.js` — corpus preprocessing
- `server/data/termCooccurrence.json` — PMI matrix (generated)
- `server/services/llmRelationAnalysis.js` — Tier 3 LLM prompt (optional)

## Files to Modify

- `server/data/disambiguation_rules.json` — add `"composites"` array (Tier 1)
- `server/services/disambiguator.js` — composite check before single-term rules
- `server/services/commentCoverage.js` — wire Tier 2 adjustments
- `server/scripts/evalPolysemy.js` — add composite-specific test cases
- `server/services/disambiguator.test.js` — add composite rule tests

## Rollout Strategy

1. **Phase 1 behind existing flag**: `BILIBILI_DISAMBIGUATION=1` (already default on)
2. **Phase 2 behind new flag**: `BILIBILI_COOCCURRENCE=1` (enable after PMI model built)
3. **Phase 3 behind opt-in flag**: `BILIBILI_LLM_RELATIONS=0` (default off, enable for high-value analysis)
4. **A/B validation**: Run `npm run dictionary:coverage` with and without each tier, compare axis score distributions
