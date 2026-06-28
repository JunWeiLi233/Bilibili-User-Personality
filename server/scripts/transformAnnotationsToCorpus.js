/**
 * Transform annotation data into a tokenized corpus for PMI computation.
 *
 * Reads .claude/annotation_data/argumentative_candidates.json (300 labeled
 * argumentative candidate comments) and produces a structured corpus with:
 *   - Term presence vectors per comment
 *   - Term frequency counts
 *   - Term co-occurrence counts
 *   - Annotator consensus labels
 *
 * Usage:
 *   node server/scripts/transformAnnotationsToCorpus.js [--output <path>]
 *
 * Output (default server/data/annotationCorpus.json):
 *   {
 *     meta: { totalComments, totalTerms, distinctTerms, families },
 *     documents: [{ id, text, terms: [...], families: {...}, consensus: {...} }],
 *     termFreq: { term: count },
 *     cooccurrence: { "termA||termB": count },
 *     familyFreq: { family: count }
 *   }
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_ANNOTATION_PATH = join(
  PROJECT_ROOT, '.claude', 'annotation_data', 'argumentative_candidates.json'
);
const DEFAULT_OUTPUT_PATH = join(__dirname, '..', 'data', 'annotationCorpus.json');

// All known keyword families
const KNOWN_FAMILIES = ['attack', 'absolutes', 'cooperation', 'evidence', 'evasion'];

// ── Consensus helpers ─────────────────────────────────────────────────────────

/**
 * Compute majority-vote consensus from 3 annotators.
 * Returns the majority value or null if tied.
 */
function majorityVote(values) {
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(counts));
  const winners = Object.entries(counts).filter(([, c]) => c === maxCount);
  if (winners.length === 1) return winners[0][0];
  return null; // tie
}

/**
 * Average of numeric values.
 */
function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute consensus annotation from 3 annotators.
 */
function computeConsensus(annotations) {
  const toxicVotes = annotations.map(a => a.toxicEmotions);
  const commitmentVotes = annotations.map(a => a.missingCommitment);
  const intelligibilityVotes = annotations.map(a => a.missingIntelligibility);
  const otherVotes = annotations.map(a => a.otherReasons);

  // Collect all gangjing subtypes
  const allSubtypes = new Set();
  for (const a of annotations) {
    for (const s of (a.gangjing_subtypes || [])) {
      allSubtypes.add(s);
    }
  }

  return {
    toxicEmotions_majority: majorityVote(toxicVotes),
    toxicEmotions_avg: average(toxicVotes),
    missingCommitment_majority: majorityVote(commitmentVotes),
    missingCommitment_avg: average(commitmentVotes),
    missingIntelligibility_majority: majorityVote(intelligibilityVotes),
    missingIntelligibility_avg: average(intelligibilityVotes),
    otherReasons_majority: majorityVote(otherVotes),
    otherReasons_avg: average(otherVotes),
    gangjing_subtypes_union: [...allSubtypes],
    // A comment is "argumentative" if at least 2/3 annotators flagged toxicEmotions ≥1
    isArgumentative: toxicVotes.filter(v => v >= 1).length >= 2,
    annotator_count: annotations.length,
  };
}

// ── Main transform ────────────────────────────────────────────────────────────

function transformAnnotations(inputPath, outputPath) {
  console.log(`[transform] Reading annotations from ${inputPath}`);
  const raw = readFileSync(inputPath, 'utf8');
  const annotations = JSON.parse(raw);

  if (!Array.isArray(annotations)) {
    throw new Error('Annotation file must be a JSON array');
  }

  console.log(`[transform] Processing ${annotations.length} comments...`);

  // ── Build documents ──
  const documents = [];
  const termFreq = {};
  const familyFreq = {};
  const cooccurrence = {}; // keyed by "termA||termB" (sorted alphabetically)

  for (const item of annotations) {
    const terms = item.keyword_terms || [];
    const families = item.keyword_families || {};

    // Term frequencies
    for (const t of terms) {
      termFreq[t] = (termFreq[t] || 0) + 1;
    }

    // Family frequencies (count once per document per family)
    const seenFamilies = new Set();
    for (const f of Object.keys(families)) {
      if (families[f] > 0) {
        familyFreq[f] = (familyFreq[f] || 0) + 1;
        seenFamilies.add(f);
      }
    }

    // Co-occurrence counts: all pairs within this document
    const sortedTerms = [...new Set(terms)].sort();
    for (let i = 0; i < sortedTerms.length; i++) {
      for (let j = i + 1; j < sortedTerms.length; j++) {
        const key = `${sortedTerms[i]}||${sortedTerms[j]}`;
        cooccurrence[key] = (cooccurrence[key] || 0) + 1;
      }
    }

    // Consensus
    const consensus = computeConsensus(item.annotations || []);

    documents.push({
      id: item.comment_id,
      text: item.comment_text,
      terms: sortedTerms,
      families: Object.fromEntries(
        Object.entries(families).filter(([, v]) => v > 0)
      ),
      consensus,
      source_uid: item.source_uid,
      heuristic_score: item.heuristic_score,
    });
  }

  // ── Sort co-occurrence by count descending ──
  const sortedCooccurrence = Object.fromEntries(
    Object.entries(cooccurrence).sort((a, b) => b[1] - a[1])
  );

  const distinctTerms = Object.keys(termFreq).sort();

  const corpus = {
    meta: {
      totalComments: documents.length,
      totalTerms: distinctTerms.length,
      distinctTerms,
      families: KNOWN_FAMILIES.filter(f => familyFreq[f]),
      generated: new Date().toISOString(),
      source: inputPath,
    },
    documents,
    termFreq: Object.fromEntries(
      Object.entries(termFreq).sort((a, b) => b[1] - a[1])
    ),
    cooccurrence: sortedCooccurrence,
    familyFreq: Object.fromEntries(
      Object.entries(familyFreq).sort((a, b) => b[1] - a[1])
    ),
  };

  console.log(`[transform] Writing corpus to ${outputPath}`);
  writeFileSync(outputPath, JSON.stringify(corpus, null, 2), 'utf8');

  // ── Summary ──
  console.log();
  console.log('='.repeat(60));
  console.log('TRANSFORM SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total comments:            ${corpus.meta.totalComments}`);
  console.log(`Distinct terms:            ${corpus.meta.totalTerms}`);
  console.log(`Term occurrences (total):  ${Object.values(termFreq).reduce((a, b) => a + b, 0)}`);
  console.log(`Term pairs (co-occurring): ${Object.keys(cooccurrence).length}`);
  console.log(`Families present:          ${corpus.meta.families.join(', ')}`);

  // Top co-occurring pairs
  console.log();
  console.log('Top 10 co-occurring term pairs:');
  const topPairs = Object.entries(sortedCooccurrence).slice(0, 10);
  for (const [pair, count] of topPairs) {
    const [a, b] = pair.split('||');
    console.log(`  ${a.padEnd(12)} + ${b.padEnd(12)} → ${count} comments`);
  }

  // Argumentative breakdown
  const argCount = documents.filter(d => d.consensus.isArgumentative).length;
  console.log();
  console.log(`Argumentative (≥2/3 annotators): ${argCount}/${documents.length} (${((argCount/documents.length)*100).toFixed(1)}%)`);

  console.log();
  console.log('Done.');
  return corpus;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_ANNOTATION_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
    } else if (arg.startsWith('--input=')) {
      inputPath = arg.slice('--input='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node server/scripts/transformAnnotationsToCorpus.js [options]');
      console.log('  --input=<path>   Path to argumentative_candidates.json');
      console.log('  --output=<path>  Output path for annotationCorpus.json');
      process.exit(0);
    }
  }

  return { inputPath, outputPath };
}

// ── Run ───────────────────────────────────────────────────────────────────────

const { inputPath, outputPath } = parseArgs();
transformAnnotations(inputPath, outputPath);
