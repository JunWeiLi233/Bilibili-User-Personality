/**
 * Lightweight Chinese term context-disambiguation engine.
 *
 * Loads disambiguation rules from server/data/disambiguation_rules.json and
 * checks whether a keyword substring match in a Bilibili comment is being used
 * in an argumentative sense or a neutral sense.
 *
 * The engine runs BEFORE keyword density computation so suppressed matches
 * are excluded from per-axis hit counts.
 *
 * API:
 *   import { disambiguate, applyDisambiguation, loadRules } from '../services/disambiguator.js';
 *
 *   const results = disambiguate(commentText, keywordMatches);
 *   // → [{ term, match, matchIndex, action, reason, confidence }, ...]
 *
 *   const suppressed = applyDisambiguation(commentText, keywordMatches);
 *   // → keywordMatches with suppressed entries removed
 *
 * Each rule has { type, description, pattern (JS regex), action, confidence }.
 * Rules are applied in order; first matching rule wins for each term match.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ─── Rule loading ───

let _rulesCache = null;

/**
 * Load disambiguation rules from the JSON file.
 * Results are cached in memory for the lifetime of the process.
 *
 * @param {string} [rulesPath] - override path to rules JSON
 * @returns {Array<{term: string, family: string, rules: Array}>}
 */
export function loadRules(rulesPath) {
  if (_rulesCache) return _rulesCache;

  const path = rulesPath || join(PROJECT_ROOT, 'data', 'disambiguation_rules.json');
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    _rulesCache = data.rules || [];
  } catch (e) {
    console.error(`[disambiguator] Failed to load rules from ${path}: ${e.message}`);
    _rulesCache = [];
  }
  return _rulesCache;
}

/**
 * Clear the rules cache (useful for testing with different rule sets).
 */
export function clearRulesCache() {
  _rulesCache = null;
}

// ─── Core disambiguation ───

/**
 * Disambiguate a single term occurrence in a comment.
 *
 * Scans all rules for the given term, applies the first matching pattern,
 * and returns the disambiguation result.
 *
 * @param {string} text - the full comment text
 * @param {string} term - the matched keyword term
 * @param {string} [family] - the keyword family (attack, absolutes, etc.)
 * @returns {{ term: string, family: string, action: string, reason: string, confidence: number } | null}
 */
export function disambiguateTerm(text, term, family) {
  const allRules = loadRules();

  // Find the rule group for this term
  const ruleGroup = allRules.find(
    (r) => r.term === term || r.term === term.toLowerCase()
  );
  if (!ruleGroup) return null;

  const clean = String(text || '');
  if (!clean) return null;

  // Try each rule in order; first match wins
  for (const rule of ruleGroup.rules) {
    try {
      const re = new RegExp(rule.pattern, 'u');
      if (re.test(clean)) {
        return {
          term,
          family: ruleGroup.family || family || 'unknown',
          action: rule.action,
          reason: rule.type,
          confidence: rule.confidence,
          description: rule.description,
        };
      }
    } catch (e) {
      // Skip invalid regex patterns
      console.error(`[disambiguator] Invalid pattern for term "${term}", rule "${rule.type}": ${e.message}`);
    }
  }

  // No rule matched — return neutral default
  return {
    term,
    family: ruleGroup.family || family || 'unknown',
    action: 'neutral',
    reason: 'no_rule_matched',
    confidence: 0.5,
    description: 'No disambiguation rule matched; using default weight',
  };
}

/**
 * Find all occurrences of a term in text (substring match, not word-boundary).
 * Returns an array of match start indices.
 *
 * @param {string} text
 * @param {string} term
 * @returns {number[]} start indices
 * @internal
 */
function findAllMatches(text, term) {
  const indices = [];
  const lower = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let start = 0;
  while ((start = lower.indexOf(lowerTerm, start)) !== -1) {
    indices.push(start);
    start += lowerTerm.length;
  }
  return indices;
}

/**
 * Get surrounding context window (±N chars) around a match.
 *
 * @param {string} text
 * @param {number} matchIndex - start index of the match
 * @param {number} termLength
 * @param {number} [window] - chars before/after (default 12)
 * @returns {{ before: string, match: string, after: string, fullContext: string }}
 * @internal
 */
export function getContext(text, matchIndex, termLength, window = 12) {
  const start = Math.max(0, matchIndex - window);
  const end = Math.min(text.length, matchIndex + termLength + window);
  return {
    before: text.slice(start, matchIndex),
    match: text.slice(matchIndex, matchIndex + termLength),
    after: text.slice(matchIndex + termLength, end),
    fullContext: text.slice(start, end),
  };
}

/**
 * Disambiguate all keyword matches in a comment.
 *
 * @param {string} commentText - the full comment text
 * @param {Array<{term: string, family?: string}>} keywordMatches - terms found in the comment
 * @returns {Array<{term: string, family: string, action: string, reason: string, confidence: number, description: string}>}
 */
export function disambiguate(commentText, keywordMatches) {
  const results = [];

  for (const match of keywordMatches) {
    const term = match.term || '';
    const family = match.family || 'unknown';
    if (!term) continue;

    const result = disambiguateTerm(commentText, term, family);
    if (result) {
      results.push(result);
    } else {
      // No rules for this term — default neutral
      results.push({
        term,
        family,
        action: 'neutral',
        reason: 'no_rules_for_term',
        confidence: 0.5,
        description: 'Term has no disambiguation rules; default weight applied',
      });
    }
  }

  return results;
}

/**
 * Apply disambiguation and return only non-suppressed keyword matches.
 *
 * This is the main integration point: call this after keyword matching
 * to filter out matches that should not count toward keyword density.
 *
 * @param {string} commentText - the full comment text
 * @param {Array<{term: string, family?: string, weight?: number}>} keywordMatches
 * @returns {Array<{term: string, family: string, weight: number, action: string, reason: string}>}
 */
export function applyDisambiguation(commentText, keywordMatches) {
  const disambiguationResults = disambiguate(commentText, keywordMatches);

  // Build a lookup: term → disambiguation action
  const termActions = new Map();
  for (const r of disambiguationResults) {
    // If multiple matches of the same term, keep the most severe (confirm > neutral > suppress)
    const existing = termActions.get(r.term);
    const severity = { confirm: 2, neutral: 1, suppress: 0 };
    if (!existing || severity[r.action] > severity[existing.action]) {
      termActions.set(r.term, { action: r.action, reason: r.reason, confidence: r.confidence });
    }
  }

  // Filter suppressed matches, boost confirmed ones
  const filtered = [];
  for (const match of keywordMatches) {
    const term = match.term || '';
    const family = match.family || 'unknown';
    const baseWeight = match.weight || 1;

    const disamb = termActions.get(term);
    if (!disamb) {
      // No disambiguation info — keep with default weight
      filtered.push({ ...match, weight: baseWeight, action: 'neutral', reason: 'no_rules' });
      continue;
    }

    if (disamb.action === 'suppress') {
      // Skip — this match is a false positive
      continue;
    }

    const weight = disamb.action === 'confirm'
      ? baseWeight * (1 + 0.2 * disamb.confidence) // boost: up to +20% for high-confidence confirms
      : baseWeight;

    filtered.push({
      ...match,
      family,
      weight,
      action: disamb.action,
      reason: disamb.reason,
    });
  }

  return filtered;
}

/**
 * Get suppression statistics for a batch of disambiguation results.
 * Useful for monitoring and debugging.
 *
 * @param {Array<{action: string}>} results - output from disambiguate()
 * @returns {{ total: number, suppressed: number, confirmed: number, neutral: number, suppressionRate: number }}
 */
export function suppressionStats(results) {
  const total = results.length;
  const suppressed = results.filter((r) => r.action === 'suppress').length;
  const confirmed = results.filter((r) => r.action === 'confirm').length;
  const neutral = results.filter((r) => r.action === 'neutral').length;
  return {
    total,
    suppressed,
    confirmed,
    neutral,
    suppressionRate: total > 0 ? Math.round((suppressed / total) * 10000) / 100 : 0,
  };
}
