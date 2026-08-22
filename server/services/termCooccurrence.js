/**
 * Tier 2: Statistical Co-occurrence Model — PMI-based term relationship analysis.
 *
 * Loads a pre-computed PMI model from server/data/termCooccurrence.json and
 * uses it at inference time to adjust keyword weights based on which terms
 * tend to co-occur in argumentative vs. neutral contexts.
 *
 * Contract:
 *   export function analyzeRelationships(commentText, matchedTerms) -> AnalyzerResult
 *
 *   AnalyzerResult: {
 *     relationships: Array<{
 *       terms: string[],
 *       type: 'cooccurrence',
 *       effect: 'boost' | 'suppress' | 'neutral',
 *       confidence: number,   // 0.0-1.0
 *       reason: string,
 *     }>,
 *     adjustedWeights: Map<string, number>,
 *   }
 *
 * The model is built by server/scripts/buildCooccurrenceModel.js and contains
 * per-pair PMI scores for high-risk vs. low-risk contexts (deltaPMI).
 * Positive deltaPMI -> terms co-occur more in argumentative contexts -> boost.
 * Negative deltaPMI -> terms co-occur more in neutral contexts -> suppress.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Model cache
// ---------------------------------------------------------------------------

/** @type {null | {pairs: Record<string, {highRiskPMI: number|null, lowRiskPMI: number|null, deltaPMI: number, count: number}>, config?: object}} */
let _model = null;

/**
 * Load the co-occurrence model from disk. Results are cached in memory.
 *
 * @param {string} [modelPath] - Override path to model JSON (for testing)
 * @returns {{pairs: Record<string, object>, config?: object}}
 */
export function loadModel(modelPath) {
  if (_model && !modelPath) return _model;
  const path = modelPath || join(ROOT, 'data', 'termCooccurrence.json');
  try {
    if (existsSync(path)) {
      _model = JSON.parse(readFileSync(path, 'utf8'));
    } else {
      _model = { pairs: {}, config: {} };
    }
  } catch {
    _model = { pairs: {}, config: {} };
  }
  return _model;
}

/**
 * Clear the model cache (useful for testing).
 */
export function clearModelCache() {
  _model = null;
}

/**
 * Inject a mock model for deterministic testing.
 * @param {object} modelData - Pairs object or full model object
 */
export function setModelForTesting(modelData) {
  if (modelData && modelData.pairs) {
    _model = modelData;
  } else {
    _model = { pairs: modelData || {} };
  }
  if (!_model.config) _model.config = {};
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOCCURRENCE_WINDOW = 25; // max char distance for pair co-occurrence
const DELTA_THRESHOLD = 0.3;    // minimum |deltaPMI| for meaningful signal
const MAX_ADJUSTMENT = 0.15;    // cap on weight adjustment factor (+-15%)

// ---------------------------------------------------------------------------
// Analysis logic
// ---------------------------------------------------------------------------

/**
 * Analyze term relationships in a comment using the PMI co-occurrence model.
 *
 * @param {string} commentText - Full comment text
 * @param {Array<{term: string, family?: string, weight?: number}>} matchedTerms
 * @returns {{
 *   relationships: Array<{
 *     terms: string[],
 *     type: 'cooccurrence',
 *     effect: 'boost' | 'suppress' | 'neutral',
 *     confidence: number,
 *     reason: string,
 *   }>,
 *   adjustedWeights: Map<string, number>,
 * }}
 */
export function analyzeRelationships(commentText, matchedTerms) {
  // Need at least 2 matched terms to form a pair
  if (!Array.isArray(matchedTerms) || matchedTerms.length < 2) {
    return { relationships: [], adjustedWeights: new Map() };
  }

  if (!commentText || typeof commentText !== 'string') {
    return { relationships: [], adjustedWeights: new Map() };
  }

  const model = loadModel();
  const pairs = model.pairs || {};

  // Find all occurrences of each matched term in the text
  const positions = [];
  for (const mt of matchedTerms) {
    const term = mt.term;
    if (!term) continue;
    let idx = 0;
    while ((idx = commentText.indexOf(term, idx)) !== -1) {
      positions.push({
        term,
        position: idx,
        weight: mt.weight ?? 1,
        family: mt.family,
      });
      idx += 1;
    }
  }

  // If no positions found, return empty
  if (positions.length < 2) {
    return { relationships: [], adjustedWeights: new Map() };
  }

  const relationships = [];
  /** @type {Map<string, number>} */
  const weightAdjustments = new Map();
  const seenPairs = new Set();

  // Check each pair of occurrences within the window
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = Math.abs(positions[i].position - positions[j].position);
      if (dist > COOCCURRENCE_WINDOW) continue;

      // Build sorted pair key for deterministic lookup
      const termA = positions[i].term;
      const termB = positions[j].term;
      const sortedTerms = [termA, termB].sort();
      const pairKey = sortedTerms.join('::');

      // Avoid duplicate relationship entries for the same term pair
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      // Look up in the model
      const pair = pairs[pairKey];
      if (!pair) continue;

      // Check if deltaPMI meets the threshold
      if (Math.abs(pair.deltaPMI) < DELTA_THRESHOLD) continue;

      // Determine effect direction
      const effect = pair.deltaPMI > 0 ? 'boost' : 'suppress';

      // Confidence increases with more observed co-occurrences
      const confidence = Math.min(0.85, pair.count / 5);

      // Calculate weight adjustment factor
      // adjustment = deltaPMI * confidence * 0.15, capped at +-MAX_ADJUSTMENT
      const rawAdjustment = pair.deltaPMI * confidence * MAX_ADJUSTMENT;
      const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdjustment));

      // Apply adjustment to both terms
      for (const term of [termA, termB]) {
        const oldWeight = weightAdjustments.get(term) ??
          (matchedTerms.find(mt => mt.term === term)?.weight ?? 1);
        const newWeight = Math.max(0, oldWeight * (1 + adjustment));
        weightAdjustments.set(term, parseFloat(newWeight.toFixed(4)));
      }

      relationships.push({
        terms: [termA, termB],
        type: 'cooccurrence',
        effect,
        confidence: parseFloat(confidence.toFixed(2)),
        reason: `PMI Delta=${pair.deltaPMI.toFixed(2)} in ${effect === 'boost' ? 'argumentative' : 'neutral'} contexts (${pair.count} co-occurrences)`,
      });
    }
  }

  return { relationships, adjustedWeights: weightAdjustments };
}
