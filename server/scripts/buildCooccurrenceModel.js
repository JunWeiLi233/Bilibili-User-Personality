/**
 * Build a PMI (Pointwise Mutual Information) co-occurrence model from the
 * annotation corpus produced by transformAnnotationsToCorpus.js.
 *
 * Computes:
 *   - Term-term PMI: how much more likely two terms appear together vs chance
 *   - Term-family PMI: which families a term tends to co-occur with
 *   - Family-family PMI: cross-family co-occurrence patterns
 *   - Argumentative association: which terms are markers of argumentative context
 *
 * PMI(x, y) = ln( P(x,y) / (P(x) * P(y)) )
 *           = ln( N * count(x,y) / (count(x) * count(y)) )
 *
 * NPMI(x, y) = PMI(x, y) / -ln(P(x,y))   (normalized to [-1, 1])
 *
 * Usage:
 *   node server/scripts/buildCooccurrenceModel.js [--corpus <path>] [--output <path>]
 *
 * With no flags, reads from server/data/annotationCorpus.json and outputs
 * to server/data/termCooccurrence.json. Falls back to synthetic corpus if
 * annotation corpus is unavailable.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..');

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CORPUS_PATH = join(PROJECT, 'server', 'data', 'annotationCorpus.json');
const DEFAULT_OUTPUT_PATH = join(PROJECT, 'server', 'data', 'termCooccurrence.json');

// ── PMI computation ───────────────────────────────────────────────────────────

function computePMI(jointCount, countX, countY, totalDocs) {
  if (jointCount === 0) {
    return { pmi: null, npmi: -1, joint: 0, expected: 0, ratio: 0 };
  }
  const N = totalDocs;
  const pJoint = jointCount / N;
  const pX = countX / N;
  const pY = countY / N;
  const expected = (countX * countY) / N;
  const pmi = Math.log(pJoint / (pX * pY));
  const npmi = pmi / (-Math.log(pJoint));
  const ratio = jointCount / Math.max(1, expected);
  return {
    pmi: Math.round(pmi * 10000) / 10000,
    npmi: Math.round(npmi * 10000) / 10000,
    joint: jointCount,
    expected: Math.round(expected * 100) / 100,
    ratio: Math.round(ratio * 100) / 100,
  };
}

function computeArgumentativeAssociation(termInArg, termTotal, argTotal, totalDocs) {
  if (termInArg === 0 || termTotal === 0) {
    return { pmi: null, npmi: -1, oddsRatio: 0, precision: 0 };
  }
  const N = totalDocs;
  const pJoint = termInArg / N;
  const pTerm = termTotal / N;
  const pArg = argTotal / N;
  const pmi = Math.log(pJoint / (pTerm * pArg));
  const npmi = pmi / (-Math.log(pJoint));
  const termNotArg = termTotal - termInArg;
  const notTermInArg = argTotal - termInArg;
  const notTermNotArg = N - termTotal - notTermInArg;
  const oddsRatio = termNotArg > 0 && notTermNotArg > 0
    ? (termInArg / termNotArg) / (notTermInArg / notTermNotArg)
    : Infinity;
  const precision = termInArg / termTotal;
  return {
    pmi: Math.round(pmi * 10000) / 10000,
    npmi: Math.round(npmi * 10000) / 10000,
    oddsRatio: Number.isFinite(oddsRatio) ? Math.round(oddsRatio * 100) / 100 : null,
    precision: Math.round(precision * 10000) / 10000,
  };
}

// ── Build from annotation corpus ──────────────────────────────────────────────

function buildFromAnnotationCorpus(corpus) {
  const { meta, documents, termFreq, cooccurrence, familyFreq } = corpus;
  const N = meta.totalComments;
  const distinctTerms = meta.distinctTerms;

  console.log('[buildPMI] Building from annotation corpus: ' + N + ' documents, ' + distinctTerms.length + ' terms');

  // Term-term PMI
  const termPMI = {};
  for (const [pairKey, jointCount] of Object.entries(cooccurrence)) {
    const [termA, termB] = pairKey.split('||');
    const countA = termFreq[termA] || 0;
    const countB = termFreq[termB] || 0;
    termPMI[pairKey] = computePMI(jointCount, countA, countB, N);
  }

  // Also compute PMI for frequent non-co-occurring pairs (negative associations)
  const topTerms = Object.entries(termFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t);

  for (let i = 0; i < topTerms.length; i++) {
    for (let j = i + 1; j < topTerms.length; j++) {
      const key = topTerms[i] + '||' + topTerms[j];
      if (termPMI[key]) continue;
      const jointCount = cooccurrence[key] || 0;
      const countA = termFreq[topTerms[i]] || 0;
      const countB = termFreq[topTerms[j]] || 0;
      if (countA >= 3 || countB >= 3) {
        termPMI[key] = computePMI(jointCount, countA, countB, N);
      }
    }
  }

  const sortedTermPMI = Object.fromEntries(
    Object.entries(termPMI)
      .filter(([, v]) => v.npmi > -1)
      .sort((a, b) => b[1].npmi - a[1].npmi)
  );

  // Term-family association
  const termFamilyAssoc = {};
  for (const term of distinctTerms) {
    const termCount = termFreq[term] || 0;
    if (termCount < 2) continue;
    const assoc = {};
    const docsWithTerm = documents.filter(d => d.terms.includes(term));
    const familyCounts = {};
    for (const doc of docsWithTerm) {
      for (const fam of Object.keys(doc.families)) {
        familyCounts[fam] = (familyCounts[fam] || 0) + 1;
      }
    }
    for (const fam of meta.families) {
      const jointCount = familyCounts[fam] || 0;
      const famCount = familyFreq[fam] || 0;
      assoc[fam] = computePMI(jointCount, termCount, famCount, N).npmi;
    }
    termFamilyAssoc[term] = assoc;
  }

  // Family-family PMI
  const familyPMI = {};
  const families = meta.families;
  for (let i = 0; i < families.length; i++) {
    for (let j = i + 1; j < families.length; j++) {
      const famA = families[i];
      const famB = families[j];
      let jointCount = 0;
      for (const doc of documents) {
        if (doc.families[famA] && doc.families[famB]) {
          jointCount++;
        }
      }
      const countA = familyFreq[famA] || 0;
      const countB = familyFreq[famB] || 0;
      const key = famA + '||' + famB;
      familyPMI[key] = computePMI(jointCount, countA, countB, N);
    }
  }

  // Argumentative markers
  const argTotal = documents.filter(d => d.consensus.isArgumentative).length;
  const argumentativeMarkers = [];
  for (const term of distinctTerms) {
    const termTotal = termFreq[term] || 0;
    if (termTotal < 2) continue;
    const termInArg = documents.filter(
      d => d.terms.includes(term) && d.consensus.isArgumentative
    ).length;
    const assoc = computeArgumentativeAssociation(termInArg, termTotal, argTotal, N);
    argumentativeMarkers.push({
      term,
      pmi: assoc.pmi,
      npmi: assoc.npmi,
      oddsRatio: assoc.oddsRatio,
      precision: assoc.precision,
      count: termTotal,
      inArg: termInArg,
    });
  }
  argumentativeMarkers.sort((a, b) => {
    const aOr = a.oddsRatio === null ? 0 : a.oddsRatio;
    const bOr = b.oddsRatio === null ? 0 : b.oddsRatio;
    return bOr - aOr;
  });

  return {
    meta: {
      totalComments: N,
      distinctTerms: distinctTerms.length,
      termPairs: Object.keys(sortedTermPMI).length,
      argumentativeDocs: argTotal,
      argumentativeRate: Math.round((argTotal / N) * 10000) / 10000,
      families,
      source: 'annotation_corpus',
      generated: new Date().toISOString(),
    },
    termPMI: sortedTermPMI,
    termFamilyAssoc,
    familyPMI,
    argumentativeMarkers: argumentativeMarkers.slice(0, 50),
  };
}

// ── Build from scored comments (legacy support) ──────────────────────────────

function findTermPositions(text, terms) {
  const positions = [];
  for (const term of terms) {
    if (!term) continue;
    let idx = 0;
    while ((idx = text.indexOf(term, idx)) !== -1) {
      positions.push({ term, position: idx });
      idx += 1;
    }
  }
  return positions;
}

function buildFromScoredCorpus(corpus, config) {
  const highTermCounts = {};
  const lowTermCounts = {};
  const highPairCounts = {};
  const lowPairCounts = {};

  for (const comment of corpus) {
    const text = comment.comment_text || '';
    const terms = (comment.keyword_terms || []).map(t =>
      typeof t === 'string' ? t : t.term
    ).filter(Boolean);

    if (terms.length < 1) continue;

    const positions = findTermPositions(text, terms);
    const counts = {};
    const pairs = {};

    for (let i = 0; i < positions.length; i++) {
      counts[positions[i].term] = (counts[positions[i].term] || 0) + 1;
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.abs(positions[i].position - positions[j].position);
        if (dist > (config.windowSize || 25)) continue;
        if (positions[i].term === positions[j].term) continue;
        const pairKey = [positions[i].term, positions[j].term].sort().join('::');
        pairs[pairKey] = (pairs[pairKey] || 0) + 1;
      }
    }

    const isHighRisk = comment.risk_score >= (config.highRiskThreshold || 0.5);
    const targetTermCounts = isHighRisk ? highTermCounts : lowTermCounts;
    const targetPairCounts = isHighRisk ? highPairCounts : lowPairCounts;

    for (const [term, cnt] of Object.entries(counts)) {
      targetTermCounts[term] = (targetTermCounts[term] || 0) + cnt;
    }
    for (const [pairKey, cnt] of Object.entries(pairs)) {
      targetPairCounts[pairKey] = (targetPairCounts[pairKey] || 0) + cnt;
    }
  }

  // Compute PMI for high and low contexts
  function calcPMI(pairCounts, termCounts) {
    const total = Object.values(termCounts).reduce((s, v) => s + v, 0);
    if (total === 0) return {};
    const results = {};
    for (const [pairKey, count] of Object.entries(pairCounts)) {
      const [a, b] = pairKey.split('::');
      const countA = termCounts[a] || 0;
      const countB = termCounts[b] || 0;
      if (countA === 0 || countB === 0) continue;
      const pmi = Math.log((count * total) / (countA * countB));
      results[pairKey] = { pmi: Math.round(pmi * 10000) / 10000, count };
    }
    return results;
  }

  const highPMI = calcPMI(highPairCounts, highTermCounts);
  const lowPMI = calcPMI(lowPairCounts, lowTermCounts);

  const allPairKeys = new Set([...Object.keys(highPMI), ...Object.keys(lowPMI)]);
  const pairs = {};
  for (const key of allPairKeys) {
    const h = highPMI[key];
    const l = lowPMI[key];
    const totalCount = (h ? h.count : 0) + (l ? l.count : 0);
    if (totalCount < (config.minCooccurrences || 3)) continue;
    const highVal = h ? h.pmi : -2.0;
    const lowVal = l ? l.pmi : -2.0;
    const deltaPMI = highVal - lowVal;
    if (Math.abs(deltaPMI) < (config.deltaThreshold || 0.3)) continue;
    pairs[key] = {
      highRiskPMI: h ? h.pmi : null,
      lowRiskPMI: l ? l.pmi : null,
      deltaPMI: Math.round(deltaPMI * 10000) / 10000,
      count: totalCount,
    };
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    pairs,
    stats: {
      corpusSize: corpus.length,
      uniqueTerms: Object.keys({ ...highTermCounts, ...lowTermCounts }).length,
      uniquePairs: Object.keys(pairs).length,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { corpus: '', output: '' };
  for (const a of argv) {
    if (a.startsWith('--corpus=')) args.corpus = a.split('=')[1];
    else if (a.startsWith('--output=')) args.output = a.split('=')[1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output || DEFAULT_OUTPUT_PATH;

  let model;

  // Try annotation corpus first (preferred)
  const corpusPath = args.corpus || DEFAULT_CORPUS_PATH;
  if (existsSync(corpusPath)) {
    try {
      const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
      if (corpus.meta && corpus.documents && corpus.termFreq) {
        // This is an annotation corpus
        model = buildFromAnnotationCorpus(corpus);
      } else if (Array.isArray(corpus)) {
        // Legacy scored-comment array
        model = buildFromScoredCorpus(corpus, {
          windowSize: 25,
          minCooccurrences: 3,
          deltaThreshold: 0.3,
          highRiskThreshold: 0.5,
        });
      } else {
        console.error('Unknown corpus format in ' + corpusPath);
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to load corpus: ' + e.message);
      process.exit(1);
    }
  } else {
    console.log('No corpus found at ' + corpusPath);
    console.log('Run: node server/scripts/transformAnnotationsToCorpus.js first');
    process.exit(1);
  }

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(model, null, 2), 'utf8');

  // ── Summary ──
  console.log();
  console.log('='.repeat(60));
  console.log('PMI MODEL SUMMARY');
  console.log('='.repeat(60));

  if (model.meta) {
    // Annotation corpus output
    console.log('Total comments:             ' + model.meta.totalComments);
    console.log('Distinct terms:             ' + model.meta.distinctTerms);
    console.log('Term pairs with PMI:        ' + model.meta.termPairs);
    console.log('Argumentative docs:         ' + model.meta.argumentativeDocs + ' (' + (model.meta.argumentativeRate * 100).toFixed(1) + '%)');
    console.log('Families:                   ' + model.meta.families.join(', '));

    console.log();
    console.log('Top 10 strongest positive term associations (NPMI):');
    const topPositive = Object.entries(model.termPMI)
      .filter(([, v]) => v.npmi > 0 && v.joint >= 2)
      .slice(0, 10);
    for (const [pair, stats] of topPositive) {
      const [a, b] = pair.split('||');
      console.log('  ' + a.padEnd(12) + ' + ' + b.padEnd(12) + ' -> NPMI=' + String(stats.npmi).padEnd(8) + ' joint=' + stats.joint);
    }

    console.log();
    console.log('Family-family NPMI:');
    for (const [pair, stats] of Object.entries(model.familyPMI)) {
      const [a, b] = pair.split('||');
      console.log('  ' + a.padEnd(12) + ' + ' + b.padEnd(12) + ' -> NPMI=' + stats.npmi + ' (joint=' + stats.joint + ')');
    }

    console.log();
    console.log('Top 10 argumentative markers (by odds ratio):');
    const topMarkers = model.argumentativeMarkers.slice(0, 10);
    for (const m of topMarkers) {
      console.log('  ' + m.term.padEnd(12) + ' -> OR=' + String(m.oddsRatio).padEnd(10) + ' (' + m.inArg + '/' + m.count + ' in arg)');
    }
  } else {
    // Legacy deltaPMI output
    console.log('  Corpus:           ' + model.stats.corpusSize + ' comments');
    console.log('  Unique terms:     ' + model.stats.uniqueTerms);
    console.log('  Unique pairs:     ' + model.stats.uniquePairs);

    const sorted = Object.entries(model.pairs)
      .sort((a, b) => Math.abs(b[1].deltaPMI) - Math.abs(a[1].deltaPMI))
      .slice(0, 15);
    if (sorted.length > 0) {
      console.log();
      console.log('Top pairs by |deltaPMI|:');
      for (const [key, val] of sorted) {
        const trend = val.deltaPMI > 0 ? 'BOOST (arg.)' : 'SUPPRESS (neut.)';
        console.log('  ' + key.padEnd(20) + ' d=' + val.deltaPMI.toFixed(2) + '  count=' + val.count + '  ' + trend);
      }
    }
  }

  console.log();
  console.log('Output: ' + outputPath);
  console.log('Done.');
}

try {
  main();
} catch (e) {
  console.error('Fatal:', e);
  process.exit(1);
}
