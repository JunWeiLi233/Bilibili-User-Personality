/**
 * Relationship Analysis Pipeline — shared contract for multi-phase word
 * relationship analysis.
 *
 * Three tiers, executed in order. Each tier handles cases the previous
 * couldn't resolve. If a tier's module is a stub (not yet built), it
 * returns empty results — no errors, no crashes.
 *
 * ── Agent work distribution (zero file overlap) ─────────────────────────
 * Phase 1 agent: disambiguator.js, disambiguation_rules.json, tests
 * Phase 2 agent: termCooccurrence.js, buildCooccurrenceModel.js, tests
 * Phase 3 agent: llmRelationAnalysis.js, tests
 *
 * This file (relationshipPipeline.js) and commentCoverage.js are the
 * shared integration scaffold — edited BEFORE agents run, not by agents.
 * ────────────────────────────────────────────────────────────────────────
 */

import { loadComposites } from './disambiguator.js';
import { analyzeRelationships as tier2Analyze } from './termCooccurrence.js';

// ─── Tier 1: Composite patterns (embedded in disambiguator.js) ──────────
// Phase 1 agent added composite rule support to disambiguator.js and
// disambiguation_rules.json. This function reads the composites array
// from the rules file via loadComposites().

function tier1CompositeAnalysis(commentText, matchedTerms) {
  const composites = loadComposites();
  if (!composites.length) return { relationships: [], adjustedWeights: new Map() };

  const relationships = [];
  const adjustedWeights = new Map();

  for (const comp of composites) {
    try {
      const re = new RegExp(comp.pattern, 'u');
      if (!re.test(commentText)) continue;

      // At least ONE of the composite's terms must be in matchedTerms
      // (otherwise this composite has no terms to adjust)
      const matchedSubset = comp.terms.filter(t =>
        matchedTerms.some(m => m.term === t)
      );
      if (matchedSubset.length === 0) continue;

      // Determine applyTo — which terms' weights to adjust
      let applyTo;
      if (comp.applyTo === 'all') {
        applyTo = matchedSubset; // only adjust terms actually present
      } else if (Array.isArray(comp.applyTo)) {
        applyTo = comp.applyTo.filter(t => matchedTerms.some(m => m.term === t));
      } else {
        applyTo = matchedSubset.includes(comp.applyTo) ? [comp.applyTo] : [];
      }
      if (applyTo.length === 0) continue;

      relationships.push({
        terms: comp.terms,
        type: 'composite',
        effect: comp.action === 'confirm' ? 'boost' : 'suppress',
        confidence: comp.confidence || 0.85,
        reason: `composite:${comp.id || comp.description}`,
      });

      for (const term of applyTo) {
        const currentWeight = matchedTerms.find(m => m.term === term)?.weight || 1;
        if (comp.action === 'suppress') {
          adjustedWeights.set(term, 0);
        } else if (comp.action === 'confirm') {
          adjustedWeights.set(term, currentWeight * (1 + 0.2 * (comp.confidence || 0.85)));
        }
      }
    } catch (_) { /* skip invalid patterns */ }
  }

  return { relationships, adjustedWeights };
}

// ─── Tier 2: Statistical co-occurrence (termCooccurrence.js) ────────────
// Phase 2 agent fills in termCooccurrence.js. Until then, the stub returns
// empty results. Fully synchronous — just JSON lookups.

function tier2CooccurrenceAnalysis(commentText, matchedTerms) {
  if (matchedTerms.length < 2) return { relationships: [], adjustedWeights: new Map() };
  try {
    return tier2Analyze(commentText, matchedTerms);
  } catch (e) {
    console.error(`[relationshipPipeline] Tier 2 error: ${e.message}`);
    return { relationships: [], adjustedWeights: new Map() };
  }
}

// ─── Tier 3: LLM fallback (llmRelationAnalysis.js) ──────────────────────
// Phase 3 agent fills in llmRelationAnalysis.js. Async (API call).
// Not called from the sync path — only from analyzeRelationshipsAsync().

let _tier3Module = null;
async function getTier3() {
  if (_tier3Module !== null) return _tier3Module;
  try {
    _tier3Module = await import('./llmRelationAnalysis.js');
    return _tier3Module;
  } catch {
    _tier3Module = { analyzeRelationships: () => ({ relationships: [], adjustedWeights: new Map() }) };
    return _tier3Module;
  }
}

// ─── Main pipeline (synchronous — Tiers 1+2) ────────────────────────────

/**
 * Run Tier 1 and Tier 2 relationship analysis synchronously.
 *
 * This is the primary integration point for commentCoverage.js.
 * Tier 1 (composite regex patterns) and Tier 2 (co-occurrence PMI lookup)
 * are both fast synchronous operations suitable for inline use during
 * comment processing.
 *
 * @param {string} commentText
 * @param {Array<{term: string, family?: string, weight?: number}>} matchedTerms
 * @param {object} [options]
 * @param {boolean} [options.enableTier2] - default true
 * @returns {{ relationships: Array, adjustedWeights: Map<string, number>, stats: object }}
 */
/**
 * Main entry point for relationship analysis. Runs Tier 1 (composite patterns
 * from disambiguator.json) and Tier 2 (statistical co-occurrence) sequentially.
 * Tiers that resolve nothing return empty results — no crashes.
 *
 * @param {string} commentText
 * @param {Array} matchedTerms
 * @param {{enableTier2?: boolean}} [options]
 * @returns {{relationships: Array, adjustedWeights: Map<string,number>, stats: object}}
 */
export function analyzeRelationships(commentText, matchedTerms, options = {}) {
  // Tier 1 (composites) can work with a single matched term — the composite's
  // regex may reference terms that aren't in the keyword dictionary (e.g.,
  // "肯定[^…]{0,8}不" where "不" isn't a keyword). Tier 2 (co-occurrence)
  // needs ≥2 terms, handled inside tier2CooccurrenceAnalysis.
  if (!matchedTerms || matchedTerms.length < 1) {
    return { relationships: [], adjustedWeights: new Map(), stats: { totalRelationships: 0, suppressedTerms: 0, byTier: {}, byType: {} } };
  }

  const allRelationships = [];
  const mergedWeights = new Map();
  const resolvedTerms = new Set();

  // ── Tier 1: Composite patterns ──
  const t1 = tier1CompositeAnalysis(commentText, matchedTerms);
  for (const rel of t1.relationships) {
    allRelationships.push({ ...rel, tier: 1 });
    if (rel.confidence >= 0.8) {
      for (const term of rel.terms) resolvedTerms.add(term);
    }
  }
  for (const [term, weight] of (t1.adjustedWeights || new Map())) {
    mergedWeights.set(term, weight);
  }

  // ── Tier 2: Co-occurrence ──
  const enableTier2 = options.enableTier2 !== false;
  if (enableTier2) {
    const remaining = matchedTerms.filter(t => !resolvedTerms.has(t.term));
    if (remaining.length >= 2) {
      const t2 = tier2CooccurrenceAnalysis(commentText, remaining);
      for (const rel of (t2.relationships || [])) {
        allRelationships.push({ ...rel, tier: 2 });
        if (rel.confidence >= 0.8) {
          for (const term of rel.terms) resolvedTerms.add(term);
        }
      }
      for (const [term, weight] of (t2.adjustedWeights || new Map())) {
        if (!mergedWeights.has(term)) mergedWeights.set(term, weight);
      }
    }
  }

  // ── Stats ──
  const byTier = {};
  const byType = {};
  for (const rel of allRelationships) {
    byTier[rel.tier] = (byTier[rel.tier] || 0) + 1;
    byType[rel.type] = (byType[rel.type] || 0) + 1;
  }

  return {
    relationships: allRelationships,
    adjustedWeights: mergedWeights,
    stats: {
      totalRelationships: allRelationships.length,
      suppressedTerms: [...mergedWeights].filter(([, w]) => w <= 0).length,
      byTier,
      byType,
    },
  };
}

/**
 * Run all three tiers including LLM fallback (async).
 * Use this for batch processing or high-value analysis where
 * the extra latency of an LLM call is acceptable.
 *
 * @param {string} commentText
 * @param {Array<{term: string, family?: string, weight?: number}>} matchedTerms
 * @param {object} [options]
 * @returns {Promise<{ relationships: Array, adjustedWeights: Map<string, number>, stats: object }>}
 */
export async function analyzeRelationshipsAsync(commentText, matchedTerms, options = {}) {
  // Run sync tiers first
  const result = analyzeRelationships(commentText, matchedTerms, options);

  // Tier 3: LLM fallback
  const enableTier3 = options.enableTier3 === true;
  if (enableTier3) {
    const resolvedTerms = new Set();
    for (const rel of result.relationships) {
      if (rel.confidence >= 0.8) {
        for (const term of rel.terms) resolvedTerms.add(term);
      }
    }
    const remaining = matchedTerms.filter(t => !resolvedTerms.has(t.term));
    if (remaining.length >= 2) {
      try {
        const mod = await getTier3();
        const t3 = await mod.analyzeRelationships(commentText, remaining, options);
        for (const rel of (t3.relationships || [])) {
          result.relationships.push({ ...rel, tier: 3 });
          result.stats.byTier[3] = (result.stats.byTier[3] || 0) + 1;
          result.stats.byType[rel.type] = (result.stats.byType[rel.type] || 0) + 1;
        }
        for (const [term, weight] of (t3.adjustedWeights || new Map())) {
          if (!result.adjustedWeights.has(term)) {
            result.adjustedWeights.set(term, weight);
          }
        }
        result.stats.totalRelationships = result.relationships.length;
        result.stats.suppressedTerms = [...result.adjustedWeights]
          .filter(([, w]) => w <= 0).length;
      } catch (e) {
        console.error(`[relationshipPipeline] Tier 3 error: ${e.message}`);
      }
    }
  }

  return result;
}

/**
 * Apply relationship-based weight adjustments to keyword matches.
 *
 * @param {Array<{term: string, weight?: number}>} keywordMatches
 * @param {Map<string, number>} adjustedWeights - term → new weight (0 = suppress)
 * @returns {Array} keywordMatches with updated weights, suppressed terms removed
 */
export function applyRelationshipWeights(keywordMatches, adjustedWeights) {
  if (!adjustedWeights || adjustedWeights.size === 0) return keywordMatches;

  return keywordMatches
    .map(match => {
      const term = match.term || '';
      const adjWeight = adjustedWeights.get(term);
      if (adjWeight === undefined) return match;
      if (adjWeight <= 0) return null; // suppressed
      return {
        ...match,
        weight: Math.round(adjWeight * 100) / 100,
        relationshipAdjusted: true,
      };
    })
    .filter(Boolean);
}
