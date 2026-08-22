#!/usr/bin/env node
/**
 * Extract Stratified Candidates for κ Annotation
 *
 * Reads .claude/personality_analysis_data_100.json, extracts all comments with
 * ≥2 keyword hits from allMatches samples, stratifies by Ziegenbein axis mapping,
 * ensures ≥30 candidates per axis, deduplicates, and outputs 200 candidates.
 *
 * Ziegenbein Axis Mapping (from .claude/KAPPA_FIX_PLAN.md):
 *   attack → toxicEmotions
 *   evasion → missingCommitment
 *   absolutes → missingIntelligibility
 *   correction/evidence → otherReasons
 *   cooperation → missingCommitment (inverse — cooperative engagement signals commitment)
 *
 * Usage:
 *   node server/scripts/extractStratifiedCandidates.js \
 *     --input .claude/personality_analysis_data_100.json \
 *     --output .claude/annotation_data/stratified_candidates.json \
 *     --min-hits 2 \
 *     --target 200 \
 *     --balance-axes
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDisambiguation, suppressionStats } from '../services/disambiguator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ─── CLI args ───
function parseArgs(argv) {
  const args = {
    input: '.claude/personality_analysis_data_100.json',
    output: '.claude/annotation_data/stratified_candidates.json',
    minHits: 2,
    target: 200,
    balanceAxes: false,
    disambiguate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--min-hits': args.minHits = parseInt(argv[++i], 10) || 2; break;
      case '--target': args.target = parseInt(argv[++i], 10) || 200; break;
      case '--balance-axes': args.balanceAxes = true; break;
      case '--disambiguate': args.disambiguate = true; break;
    }
  }
  return args;
}

// ─── Ziegenbein axis mapping ───
const FAMILY_TO_AXIS = {
  attack: 'toxicEmotions',
  evasion: 'missingCommitment',
  absolutes: 'missingIntelligibility',
  correction: 'otherReasons',
  evidence: 'otherReasons',
  cooperation: 'missingCommitment', // inverse — cooperative engagement signals commitment
};

const AXIS_LABELS = {
  toxicEmotions: '毒性情绪',
  missingCommitment: '缺少承诺',
  missingIntelligibility: '缺少可理解性',
  otherReasons: '其他原因',
};

// ─── Main ───
function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('Extract Stratified Candidates');
  console.log(`  Input: ${args.input}`);
  console.log(`  Output: ${args.output}`);
  console.log(`  Min Hits: ${args.minHits}`);
  console.log(`  Target: ${args.target}`);
  console.log(`  Balance Axes: ${args.balanceAxes}`);
  console.log();

  // 1. Load analysis data
  const inputPath = resolve(PROJECT_ROOT, args.input);
  let data;
  try {
    data = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR loading input file: ${e.message}`);
    process.exit(1);
  }

  const analyses = data.analyses || {};
  const userCount = Object.keys(analyses).length;
  console.log(`Loaded ${userCount} users from ${args.input}`);
  console.log(`Summary: ${data.summary?.users || userCount} users, ${data.summary?.totalMessages || '?'} messages, ${data.summary?.totalHits || '?'} hits`);
  if (args.disambiguate) {
    console.log('Disambiguation: ENABLED — suppressing false-positive keyword matches');
  }
  console.log();

  // Stats tracking for disambiguation
  let totalRawMatches = 0;
  let totalSuppressedMatches = 0;
  const suppressedByTerm = {};

  // 2. Extract all comment samples from allMatches, grouped by text
  const commentMap = new Map(); // normalizedText → { text, terms: Set, families: Map, uid, source, time }

  for (const [uid, analysis] of Object.entries(analyses)) {
    const allMatches = analysis.allMatches || [];
    for (const match of allMatches) {
      const family = match.family || 'unknown';
      const term = match.term || '';
      for (const sample of (match.samples || [])) {
        const rawText = (sample.text || '').trim();
        if (rawText.length < 4) continue;

        // Normalize: collapse whitespace, take first 200 chars as key
        const normText = rawText.replace(/\s+/g, ' ').trim();
        const key = normText.slice(0, 200).toLowerCase();

        if (!commentMap.has(key)) {
          commentMap.set(key, {
            text: normText.slice(0, 300),
            terms: new Set(),
            families: new Map(), // family → hit count
            uid,
            source: sample.source || 'unknown',
            time: sample.time || 0,
          });
        }

        const entry = commentMap.get(key);
        totalRawMatches++;

        // Apply disambiguation if enabled
        if (args.disambiguate) {
          const wasSuppressed = (() => {
            try {
              const results = applyDisambiguation(rawText, [{ term, family }]);
              // If applyDisambiguation returns empty array, the match was suppressed
              if (results.length === 0) return true;
              // If the result has explicit suppress action, count it
              if (results[0] && results[0].action === 'suppress') return true;
              return false;
            } catch (e) {
              // Fallback: if disambiguator errors, keep the match
              return false;
            }
          })();

          if (wasSuppressed) {
            totalSuppressedMatches++;
            suppressedByTerm[term] = (suppressedByTerm[term] || 0) + 1;
            continue; // Skip this match — don't count it
          }
        }

        entry.terms.add(term);
        entry.families.set(family, (entry.families.get(family) || 0) + 1);
      }
    }
  }

  console.log(`Unique comment texts: ${commentMap.size}`);
  if (args.disambiguate) {
    const suppressionRate = totalRawMatches > 0
      ? Math.round((totalSuppressedMatches / totalRawMatches) * 10000) / 100
      : 0;
    console.log(`Disambiguation stats: ${totalSuppressedMatches}/${totalRawMatches} matches suppressed (${suppressionRate}%)`);
    const topSuppressed = Object.entries(suppressedByTerm)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    if (topSuppressed.length > 0) {
      console.log('Top suppressed terms:');
      for (const [term, count] of topSuppressed) {
        console.log(`  ${term}: ${count}`);
      }
    }
  }

  // 3. Filter: ≥minHits distinct terms (with fallback for sparse axes)
  const allAxes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];
  const stratified = Object.fromEntries(allAxes.map((ax) => [ax, []]));
  // Secondary pool: 1-hit candidates ONLY for correction/evidence → otherReasons fallback
  const otherReasonsFallback = [];
  let candidates = 0;

  for (const [, entry] of commentMap) {
    // Check if this entry has correction/evidence hits specifically
    const hasCorrectionEvidence = (entry.families.get('correction') || 0) + (entry.families.get('evidence') || 0) > 0;

    if (entry.terms.size < args.minHits) {
      // Fallback: collect 1-hit correction/evidence comments for otherReasons padding
      if (hasCorrectionEvidence && entry.terms.size >= 1) {
        otherReasonsFallback.push(entry);
      }
      continue;
    }
    candidates++;

    // Determine primary Ziegenbein axis from family hits
    const axisVotes = {};
    for (const [family, count] of entry.families) {
      const axis = FAMILY_TO_AXIS[family];
      if (!axis) continue;
      axisVotes[axis] = (axisVotes[axis] || 0) + count;
    }

    // Skip if no axis mapping (e.g., only unknown families)
    if (Object.keys(axisVotes).length === 0) continue;

    // Primary axis = most family hits
    let primaryAxis = 'otherReasons';
    let maxVotes = 0;
    for (const [axis, votes] of Object.entries(axisVotes)) {
      if (votes > maxVotes) {
        maxVotes = votes;
        primaryAxis = axis;
      }
    }

    const candidate = {
      text: entry.text,
      uid: entry.uid,
      source: entry.source,
      time: entry.time,
      primaryAxis,
      distinctTerms: entry.terms.size,
      families: Object.fromEntries(entry.families),
      terms: [...entry.terms].sort(),
      axisVotes,
    };

    if (stratified[primaryAxis]) {
      stratified[primaryAxis].push(candidate);
    }
  }

  console.log(`Candidates with ≥${args.minHits} distinct keyword hits: ${candidates}`);
  for (const [axis, items] of Object.entries(stratified)) {
    console.log(`  ${axis} (${AXIS_LABELS[axis]}): ${items.length} candidates`);
  }

  // 4. Stratify: sort by signal strength, ensure ≥30 per axis
  const MIN_PER_AXIS = 30;
  const perAxisTarget = Math.floor(args.target / allAxes.length);
  const selected = [];
  const seenTexts = new Set();

  for (const axis of allAxes) {
    let items = stratified[axis] || [];

    // Fallback padding for otherReasons: include 1-hit correction/evidence comments
    if (axis === 'otherReasons' && items.length < MIN_PER_AXIS && otherReasonsFallback.length > 0) {
      // Filter fallback to unseen texts, sort by term count
      const fresh = otherReasonsFallback
        .filter((e) => !seenTexts.has(e.text.slice(0, 100).toLowerCase()))
        .sort((a, b) => b.terms.size - a.terms.size);
      console.log(`  otherReasons fallback pool: ${fresh.length} 1-hit correction/evidence comments`);
      // Convert fallback entries to candidate shape
      for (const entry of fresh) {
        const axisVotes = {};
        for (const [family, count] of entry.families) {
          const ax = FAMILY_TO_AXIS[family];
          if (!ax) continue;
          axisVotes[ax] = (axisVotes[ax] || 0) + count;
        }
        items.push({
          text: entry.text,
          uid: entry.uid,
          source: entry.source,
          time: entry.time,
          primaryAxis: 'otherReasons',
          distinctTerms: entry.terms.size,
          families: Object.fromEntries(entry.families),
          terms: [...entry.terms].sort(),
          axisVotes,
        });
      }
    }

    // Sort by distinct term count (more hits = stronger behavioral signal)
    items.sort((a, b) => b.distinctTerms - a.distinctTerms);

    let quota = args.balanceAxes
      ? Math.max(Math.min(items.length, perAxisTarget), Math.min(items.length, MIN_PER_AXIS))
      : Math.min(items.length, perAxisTarget);

    // If another axis is below MIN_PER_AXIS, redistribute its deficit to axes with surplus
    if (args.balanceAxes && axis !== 'otherReasons') {
      const otherCount = stratified['otherReasons']?.length || 0;
      const otherFallbackCount = otherReasonsFallback.length;
      const otherMax = Math.max(otherCount, Math.min(otherCount + otherFallbackCount, MIN_PER_AXIS));
      if (otherMax < MIN_PER_AXIS) {
        // Redistribute: the 3 main axes share the deficit
        const deficit = MIN_PER_AXIS - otherMax;
        const extraEach = Math.ceil(deficit / 3);
        quota = Math.min(items.length, perAxisTarget + extraEach);
      }
    }

    let taken = 0;
    for (const item of items) {
      if (taken >= quota) break;
      // Deduplicate across axes (same text can be primary for only one axis)
      const dedupKey = item.text.slice(0, 100).toLowerCase();
      if (seenTexts.has(dedupKey)) continue;
      seenTexts.add(dedupKey);
      selected.push(item);
      taken++;
    }
    console.log(`  → ${axis}: selected ${taken}/${items.length} (quota: ${quota})`);
  }

  console.log(`Selected: ${selected.length} stratified candidates`);

  // 5. Format output for annotator
  const output = selected.slice(0, args.target).map((c, i) => ({
    comment_id: `strat_${String(i + 1).padStart(4, '0')}`,
    comment_text: c.text,
    source_uid: c.uid,
    source_file: 'personality_analysis_data_100.json',
    keyword_families: c.families,
    keyword_terms: c.terms,
    primary_axis: c.primaryAxis,
    distinct_terms: c.distinctTerms,
    annotations: [],
  }));

  // 6. Write output
  const outputPath = resolve(PROJECT_ROOT, args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nDone! Wrote ${output.length} stratified candidates to ${args.output}`);

  // 7. Summary statistics
  const axisCounts = {};
  for (const c of output) {
    axisCounts[c.primary_axis] = (axisCounts[c.primary_axis] || 0) + 1;
  }
  console.log('\nPer-axis distribution:');
  for (const [axis, count] of Object.entries(axisCounts)) {
    const label = AXIS_LABELS[axis] || axis;
    const bar = '█'.repeat(Math.round(count / 2));
    console.log(`  ${axis} (${label}): ${count} ${bar}`);
  }

  const allTerms = output.flatMap((c) => c.keyword_terms);
  const termFreq = {};
  for (const t of allTerms) {
    termFreq[t] = (termFreq[t] || 0) + 1;
  }
  const topTerms = Object.entries(termFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log('\nTop keywords in candidates:');
  for (const [term, count] of topTerms) {
    console.log(`  ${term}: ${count}`);
  }

  // Gate check: warn if any axis has < 30
  const below30 = Object.entries(axisCounts).filter(([, c]) => c < MIN_PER_AXIS);
  if (below30.length > 0) {
    console.log(`\n⚠ WARNING: ${below30.length} axes below ${MIN_PER_AXIS} minimum:`);
    for (const [axis, count] of below30) {
      console.log(`  ${axis}: ${count} (need ≥${MIN_PER_AXIS})`);
    }
    console.log('  Annotation may have insufficient statistical power for these axes.');
  } else {
    console.log(`\n✅ All axes ≥${MIN_PER_AXIS} candidates — sufficient for κ computation.`);
  }
}

main();
