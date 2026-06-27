# Phase 2 — Cross-Domain Validation Report: History vs Gaming

**Generated:** 2026-06-27T23:24:17.680Z
**Dictionary:** 1726 terms across 6 behavioral families
**History baseline:** 100 users from "中华" (Chinese national identity) seed domain
**Gaming domain:** 70 users with gaming-related comment history

---

## Executive Summary

This report compares the 6-axis behavioral keyword model's performance across two domains:
- **History/Identity domain** (baseline): 100 users from a patriotic national-identity seed video
- **Gaming domain**: 70 users whose AICU-indexed comments reference gaming topics

The question: **Does the model measure discourse patterns, or memorized vocabulary?**
If axis distributions shift predictably between domains, the model captures real behavioral patterns.
If they don't shift, the model may be overfit to history-domain vocabulary.

## 1. Side-by-Side Comparison

### Overall Statistics

| Metric | History (n=100) | Gaming (n=70) | Δ |
|--------|----------------|-------------------|---|
| Users with matches | 94 (94%) | 70 (100%) | 6pp |
| Total messages | 4,449 | 8,215 | 85% |
| Total keyword hits | 1,791 | 4,539 | 153% |
| Distinct terms | 1,084 | 2,226 | 105% |
| Avg msgs/user | 44.5 | 117.4 | 164% |
| Avg hits/user | 17.9 | 64.8 | 262% |
| Avg distinct terms/user | 10.8 | 31.8 | 193% |
| Hits per message | 0.403 | 0.553 | 37.3% |

### Axis Distribution Comparison

| Axis | History Hits (% of total) | Gaming Hits (% of total) | Shift | Interpretation |
|------|--------------------------|-------------------------|-------|----------------|
| **Attack** | 484 (27.0%) | 1329 (29.3%) | +2.3pp [66→70 users] | ⚠️ Gaming users more adversarial — matches expectation |
| **Absolutes** | 320 (17.9%) | 742 (16.3%) | -1.5pp [65→69 users] | ✅ Similar levels |
| **Evasion** | 24 (1.3%) | 48 (1.1%) | -0.3pp [21→32 users] | ✅ Similar or lower |
| **Cooperation** | 907 (50.6%) | 2300 (50.7%) | +0.0pp [80→70 users] | ✅ Similar levels |
| **Correction** | 15 (0.8%) | 29 (0.6%) | -0.2pp [10→22 users] | ✅ Similar or higher |
| **Evidence** | 41 (2.3%) | 91 (2.0%) | -0.3pp [27→45 users] | ✅ Similar levels |

### Axis Activation Rates (% of Users)

| Axis | History | Gaming | Δ |
|------|---------|--------|---|
| Attack | 66/100 (66%) | 70/70 (100%) | 34pp |
| Absolutes | 65/100 (65%) | 69/70 (99%) | 34pp |
| Evasion | 21/100 (21%) | 32/70 (46%) | 25pp |
| Cooperation | 80/100 (80%) | 70/70 (100%) | 20pp |
| Correction | 10/100 (10%) | 22/70 (31%) | 21pp |
| Evidence | 27/100 (27%) | 45/70 (64%) | 37pp |

### Per-User Score Distribution

| Score Range | History (n=100) | Gaming (n=70) |
|-------------|----------------|----------------|
| 0 (no matches) | 6 (6%) | 0 (0%) |
| 1–5 (low) | 0 | 0 |
| 6–20 (moderate) | 0 | 0 |
| 21–50 (high) | 0 | 27 |
| 51+ (extreme) | 0 | 43 |

## 2. Gaming Domain — Top Terms

| Rank | Term | Hits | Users | Family |
|------|------|------|-------|--------|
| 1 | `就是` | 371 | 64 | cooperation |
| 2 | `不是` | 355 | 62 | attack |
| 3 | `没有` | 253 | 64 | absolutes |
| 4 | `哈哈` | 204 | 45 | cooperation |
| 5 | `都是` | 190 | 52 | absolutes |
| 6 | `哈哈哈` | 180 | 38 | attack |
| 7 | `笑哭` | 160 | 39 | cooperation |
| 8 | `觉得` | 132 | 42 | cooperation |
| 9 | `可能` | 117 | 49 | cooperation |
| 10 | `应该` | 109 | 47 | cooperation |
| 11 | `确实` | 90 | 38 | cooperation |
| 12 | `肯定` | 58 | 30 | absolutes |
| 13 | `吃瓜` | 57 | 24 | cooperation |
| 14 | `我觉得` | 57 | 27 | cooperation |
| 15 | `打call` | 57 | 20 | cooperation |
| 16 | `为什么` | 56 | 32 | evidence |
| 17 | `脱单` | 53 | 20 | cooperation |
| 18 | `死了` | 50 | 37 | attack |
| 19 | `支持` | 49 | 27 | cooperation |
| 20 | `应该是` | 46 | 27 | cooperation |

## 3. Domain-Specific Analysis

### Gaming vs History — Behavioral Profile Differences

**Prediction:** Gaming discourse should show:
- Higher attack (competitive rivalries, platform wars, "trash talk" culture)
- Lower cooperation (less collaborative deliberation, more opinion expression)
- More meme/emote density (short-form reactions, inside jokes)
- Less evidence citation (opinion-dominated, fewer academic citations)

**Observations:**

ℹ️ **Attack levels similar**: Gaming (29.3%) vs History (27.0%). The model detects adversarial language equally across domains — vocabulary is not domain-trapped.

ℹ️ **Cooperation levels comparable** (50.7% vs 50.6%). The cooperation axis captures discourse patterns present in both domains.

✅ **Evasion axis activated**: Gaming domain shows evasion signals (1.1% of hits, 32 users). The expanded dictionary (120 terms, up from 93) improves detection in both domains.

## 4. Model Robustness Assessment

**Key finding: Limited domain sensitivity.** The axis distribution is similar across domains. This could mean either: (a) Bilibili discourse patterns are consistent across topics, or (b) the model is overfit to general vocabulary rather than domain-specific patterns.

**User coverage is stable**: 100% of gaming users vs 94% of history users matched — the dictionary's reach is domain-consistent.

## 5. Recommendations

1. **Expand gaming-specific dictionary sub-family**: Add terms for platform wars ("主机狗", "PC党"), game-specific slang ("白嫖", "云玩家"), and competitive trash talk patterns.
2. **Continue sparse axis expansion**: Evasion, evidence, and correction axes need domain-diverse seed data for further term generation.
3. **Test on more domains**: Tech, entertainment, and social/political domains would provide a fuller picture of cross-domain validity.
4. **Normalize for message length**: Gaming comments tend to be shorter (more danmaku-style reactions). Per-character or per-message normalization may improve comparability.
5. **Use gaming-specific seed videos for UID extraction**: The current gaming sample is keyword-filtered from a history-domain database. Direct extraction from gaming seed videos would improve domain purity.

---
*Report generated via Phase 2 cross-domain validation pipeline | Dictionary: 1726 terms | Baseline: 100 history users | Gaming: 70 users | Expanded axes: evasion=120, evidence=87, correction=84*