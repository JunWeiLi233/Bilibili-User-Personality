/**
 * PMI co-occurrence model loader.
 *
 * Loads server/data/termCooccurrence.json (built by buildCooccurrenceModel.js)
 * and provides lookup functions for term co-occurrence PMI scores and
 * argumentative association metrics.
 *
 * Used by the disambiguator to contextually adjust confidence when multiple
 * terms co-occur in the same comment.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

let _modelCache = null;

/**
 * Load the PMI co-occurrence model.
 * @param {string} [modelPath] - path to termCooccurrence.json
 * @returns {object} the model
 */
export function loadCooccurrenceModel(modelPath) {
  if (_modelCache) return _modelCache;

  const path = modelPath || join(PROJECT_ROOT, 'data', 'termCooccurrence.json');
  try {
    const raw = readFileSync(path, 'utf8');
    _modelCache = JSON.parse(raw);
  } catch (e) {
    console.error('[cooccurrenceModel] Failed to load model: ' + e.message);
    _modelCache = { termPMI: {}, termFamilyAssoc: {}, argumentativeMarkers: [], meta: {} };
  }
  return _modelCache;
}

/**
 * Clear model cache (useful for testing).
 */
export function clearModelCache() {
  _modelCache = null;
}

/**
 * Get the normalized PMI between two terms.
 * Returns NPMI score in [-1, 1] or null if not in model.
 *
 * @param {string} termA
 * @param {string} termB
 * @returns {{ npmi: number, pmi: number, joint: number } | null}
 */
export function getTermPMI(termA, termB) {
  const model = loadCooccurrenceModel();
  const key = [termA, termB].sort().join('||');
  return model.termPMI[key] || null;
}

/**
 * Get the strongest PMI associations for a term.
 *
 * @param {string} term - the term to look up
 * @param {number} [minJoint=1] - minimum co-occurrence count
 * @param {number} [minNpmi=0.1] - minimum NPMI threshold
 * @returns {Array<{ term: string, npmi: number, joint: number }>}
 */
export function getTermAssociations(term, minJoint = 1, minNpmi = 0.1) {
  const model = loadCooccurrenceModel();
  const results = [];

  for (const [pairKey, stats] of Object.entries(model.termPMI || {})) {
    const [a, b] = pairKey.split('||');
    if (a !== term && b !== term) continue;
    if (stats.joint < minJoint) continue;
    if (stats.npmi < minNpmi) continue;

    const other = a === term ? b : a;
    results.push({ term: other, npmi: stats.npmi, joint: stats.joint });
  }

  return results.sort((a, b) => b.npmi - a.npmi);
}

/**
 * Check if a set of terms in a comment have strong co-occurrence support.
 * Returns a boost factor if multiple terms in the comment are strongly associated.
 *
 * @param {string[]} commentTerms - terms present in the comment
 * @param {string} targetTerm - the term being disambiguated
 * @returns {{ boost: number, supportingTerms: string[] }}
 */
export function getCooccurrenceBoost(commentTerms, targetTerm) {
  const model = loadCooccurrenceModel();
  let totalNpmi = 0;
  const supportingTerms = [];

  for (const otherTerm of commentTerms) {
    if (otherTerm === targetTerm) continue;
    const key = [targetTerm, otherTerm].sort().join('||');
    const stats = model.termPMI ? model.termPMI[key] : null;
    if (stats && stats.npmi > 0.2 && stats.joint >= 2) {
      totalNpmi += stats.npmi;
      supportingTerms.push(otherTerm);
    }
  }

  // Boost proportional to the sum of NPMI scores, capped at 0.15
  const boost = Math.min(0.15, totalNpmi * 0.3);
  return { boost, supportingTerms };
}

/**
 * Get the argumentative association for a term.
 * Returns how strongly this term is associated with argumentative comments.
 *
 * @param {string} term
 * @returns {{ oddsRatio: number|null, precision: number, npmi: number, inArg: number, count: number } | null}
 */
export function getArgumentativeAssociation(term) {
  const model = loadCooccurrenceModel();
  const markers = model.argumentativeMarkers || [];
  return markers.find(m => m.term === term) || null;
}

/**
 * Get the family association profile for a term.
 * Returns a map of family → NPMI score.
 *
 * @param {string} term
 * @returns {Record<string, number> | null}
 */
export function getTermFamilyProfile(term) {
  const model = loadCooccurrenceModel();
  return (model.termFamilyAssoc || {})[term] || null;
}

/**
 * Check if a term is a strong argumentative marker.
 * Strong markers have odds ratio > 3 and appear in at least 3 argumentative docs.
 *
 * @param {string} term
 * @returns {boolean}
 */
export function isStrongArgumentativeMarker(term) {
  const assoc = getArgumentativeAssociation(term);
  if (!assoc) return false;
  return (assoc.oddsRatio !== null && assoc.oddsRatio > 3) && assoc.inArg >= 3;
}
