# Reason Protocol — Word Relationship Analysis for Bilibili Comment Analyzer

**Date**: 2026-06-28
**Task**: Current model analyzes single word instead of connects word's relationship with each other — find the most effective way to implement word relationship analysis and improve the model
**Domain**: Software architecture / NLP pipeline
**Mode**: Convergent (convergence reached at Round 1)

## Problem Analysis

### Current State

The Bilibili comment analyzer uses a keyword dictionary approach:
1. `commentCoverage.js` matches 1,726 dictionary terms in comment text via substring/regex
2. `disambiguator.js` applies 104 regex rules to suppress false-positive keyword matches
3. `contextClassifier.js` classifies the comment's scenario (taunting/argument/praise/etc.)
4. `languageUnderstanding.js` maps keyword hits to 6 radar axes (对抗性动机, 绝对化思维, etc.)

**The gap**: Each keyword is matched and scored independently. There is zero modeling of how words relate to each other:
- "不是他傻" vs "不是傻就是蠢" → same keywords matched, very different meanings
- "策划肯定没测试过" → "肯定" (absolutist) + "策划" (target) + "没测试" (accusation) — these three terms together signal an attack, but each is scored independently
- The disambiguator looks at surrounding context for individual terms but never considers term A's relationship with term B

### Why This Matters

In Chinese argumentative discourse, meaning is highly compositional:
- Negation scope: "不是X" changes the meaning of X
- Intensifier coupling: "完全就是" strengthens what follows
- Target-accusation binding: "策划" + "垃圾" = attack; "策划" + "辛苦了" = praise
- Rhetorical structures: "为什么X还不是因为Y" = accusation disguised as question

Without relationship modeling, the system:
- Overcounts attacks (each hostile word counted independently)
- Misses mitigated attacks (negation + hostile word = non-attack)
- Can't distinguish direct attacks from quoted/reported attacks

## Round 1

### Candidate A: N-gram Composite Pattern Matching

**Proposed by**: Author-A
**Approach**: Extend existing regex disambiguator with multi-term composite patterns

**Core mechanism**:
1. Identify high-value term pairs from the dictionary
2. Generate composite regex patterns spanning both terms
3. Match composites FIRST (highest priority), then fall back to single-term matching
4. Composite match overrides individual term scores

**Strengths**:
- Builds directly on existing `disambiguation_rules.json` infrastructure
- Zero new dependencies
- Fast (regex, not ML)
- Incrementally deployable
- Deterministic and debuggable

**Weaknesses**:
- O(n²) pattern explosion — 1,726 terms → millions of potential pairs
- No generalization across synonyms ("不是...傻" doesn't help with "不是...蠢")
- Window rigidity — breaks on punctuation, emotes, line breaks
- Misses implicit semantic relationships (distant but related terms)
- Manual authoring doesn't scale beyond ~100 patterns

### Candidate B: Statistical Co-occurrence + Lightweight ML

**Proposed by**: Author-B
**Approach**: Learn term-pair relationships from the existing scored corpus

**Core mechanism**:
1. Extract all term pairs from the existing corpus within a configurable window
2. Compute PMI (Pointwise Mutual Information) for each pair in argumentative vs. neutral contexts
3. At inference: look up PMI for each term pair in the comment → adjust individual term weights
4. Optional: Train a lightweight classifier (logistic regression) on pair features for higher accuracy

**Strengths**:
- Scales to all 1,726 terms automatically
- Generalizes across synonyms (statistical)
- Handles both near and far pairs
- Quantifiable (PMI scores give clear signal strength)
- Uses existing corpus data (no new labeling needed)
- Learns Bilibili-specific patterns (informal language, memes)

**Weaknesses**:
- Cold-start: needs sufficient corpus data for reliable PMI
- Rare pairs get unreliable scores
- Doesn't capture long-range dependency structures
- PMI is symmetric — can't capture directional relationships (X modifies Y vs Y modifies X)
- Requires corpus preprocessing infrastructure

### Candidate AB (Synthesized): Hybrid Cascade Pipeline

**Proposed by**: Synthesizer
**Approach**: Three-tier cascade combining the strengths of both approaches

**Tier 1 — High-Precision Composite Patterns** (from Candidate A):
- Hand-author ~50-100 high-value composite patterns for the most frequent, highest-impact term pairs
- New `"composite": true` field in `disambiguation_rules.json`
- When a composite pattern fires, it takes precedence over all single-term rules
- Covers ~30% of relationship cases with near-100% precision
- Ships immediately — ~2 hours of work

**Tier 2 — Statistical Co-occurrence Model** (from Candidate B):
- Compute PMI scores from the existing scored corpus
- For term pairs not covered by Tier 1, apply PMI-based weight adjustment
- New module: `server/services/termCooccurrence.js`
- Covers ~50% of relationship cases with moderate confidence
- Ships after corpus preprocessing — ~4 hours of work

**Tier 3 — LLM Fallback** (for edge cases):
- When Tiers 1+2 produce low-confidence results (< 0.6), fall back to DeepSeek
- Structured prompt asking for relationship analysis between matched terms
- Covers remaining ~20% of cases
- Leverages existing DeepSeek integration
- Ships when needed — ~2 hours of work

**Integration**: All three tiers feed into `applyDisambiguation()` in `disambiguator.js`, which already filters and adjusts keyword weights. The cascade is transparent to downstream consumers.

**Graceful degradation**:
- Tier 2 down → Tier 1 still works (deterministic patterns)
- Tier 3 down → Tiers 1+2 still work (no API dependency)
- All tiers down → falls back to existing single-term disambiguation

### Judge Deliberation

**Judge 1 (Architecture)**: Cascade pattern is battle-tested in NLP pipelines. Integration point already exists (`applyDisambiguation`). Tiered fallback ensures robustness. **Votes: AB**.

**Judge 2 (Practicality)**: Phased implementation is realistic. Tier 1 ships today with immediate impact. Tier 2 improves as corpus grows. Tier 3 is on-demand. **Votes: AB**.

**Judge 3 (Risk)**: Three code paths add complexity, but graceful degradation prevents catastrophic failure. Feature flags at each tier allow safe rollout. **Votes: AB**.

**Verdict**: Candidate AB wins unanimously (3/3). Convergence reached in Round 1.

## Final Recommendation

### The Hybrid Cascade Architecture

```
Comment text
    │
    ▼
┌─────────────────────────────────────────┐
│ Tier 1: Composite Pattern Matching      │
│ ~100 hand-authored patterns             │
│ Confidence: ≥ 0.85                      │
│ Covers: ~30% of relationship cases      │
└─────────────────────────────────────────┘
    │ (unmatched pairs fall through)
    ▼
┌─────────────────────────────────────────┐
│ Tier 2: Statistical Co-occurrence (PMI) │
│ Learned from existing scored corpus     │
│ Confidence: 0.6–0.85                    │
│ Covers: ~50% of relationship cases      │
└─────────────────────────────────────────┘
    │ (low-confidence pairs fall through)
    ▼
┌─────────────────────────────────────────┐
│ Tier 3: LLM Relationship Analysis       │
│ DeepSeek structured prompt              │
│ Confidence: variable (LLM-calibrated)   │
│ Covers: ~20% of relationship cases      │
└─────────────────────────────────────────┘
    │
    ▼
applyDisambiguation() → filtered keyword weights → axis scoring
```

### Implementation Phases

**Phase 1 (immediate, ~2 hrs)**: Tier 1 — Composite Patterns
- Add `"composite"` rule type to `disambiguation_rules.json`
- Author ~50 patterns for the highest-impact term pairs
- Modify `disambiguateTerm()` to check composite patterns first
- Verify with polysemy eval (no regressions)

**Phase 2 (short-term, ~4 hrs)**: Tier 2 — Co-occurrence Model
- Build corpus preprocessing script to extract term pairs from scored comments
- Compute PMI matrices per family
- Implement `termCooccurrence.js` module
- Wire into `applyDisambiguation()` as second stage
- Feature-flag: `BILIBILI_COOCCURRENCE`

**Phase 3 (on-demand, ~2 hrs)**: Tier 3 — LLM Fallback
- Add DeepSeek prompt template for relationship analysis
- Implement fallback logic in `applyDisambiguation()`
- Feature-flag: `BILIBILI_LLM_RELATIONS`

### Success Metrics

| Metric | Current | Target (Phase 1) | Target (Phase 2) |
|---|---|---|---|
| Terms analyzed in isolation | 100% | ~70% | ~20% |
| Terms analyzed with relationship context | 0% | ~30% | ~80% |
| False positive attack detections | baseline | -15% | -40% |
| Polysemy eval accuracy | 83.3% | ≥88% | ≥92% |
| Processing overhead per comment | 0ms | <1ms | <5ms |
