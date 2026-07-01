#!/usr/bin/env node
/**
 * Split-Half (Test-Retest) Reliability for the person-level trollIndex.
 *
 * The comment-level classifier is κ-validated, but the per-user trollIndex
 * composite has no demonstrated stability — the weakest link named in the
 * validity review. This script closes that gap: for each user, split comments
 * into two temporal halves, re-score each half independently via the production
 * headless scorer, and correlate the two trollIndex vectors across users.
 *
 *   High r  → composite is a stable screening signal (usable as a snapshot).
 *   Low r   → composite is unstable; a single scrape is not a trait read.
 *
 * Input:  .claude/random_sampling_eval/user_data/*.json  (comments[] with .time)
 * Usage:
 *   node server/scripts/splitHalfReliability.js               # real data
 *   node server/scripts/splitHalfReliability.js --self-check  # synthetic, proves the math
 *
 * References:
 *   - Spearman (1904). "The Proof and Measurement of Association between Two Things."
 *   - Fisher (1915). Frequency distribution of the correlation coefficient.
 *
 * NOTE: Needs the eval's user_data (runRandomSamplingEval.js --step 2). Until
 *       that data exists, only --self-check runs.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreComments, buildRuntimeLexicon, mergeDictionaryFamilies } from '../services/headlessScorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const USER_DATA_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'user_data');
const MIN_PER_HALF = 10; // each half must be scoreable on its own

// Default lexicon. Use --full-lexicon to also merge
// server/data/deepseekKeywordDictionary.entries/* (parity with the eval scorer,
// runRandomSamplingEval step 3). Reliability correlation is fairly robust to
// lexicon choice — both halves share it — but the full-lexicon run is the
// bulletproof version to cite.
let runtimeLexicon = buildRuntimeLexicon();

const DICT_DIR = join(ROOT, 'server', 'data', 'deepseekKeywordDictionary.entries');

async function loadDictionaryFamilies() {
  // Mirrors runRandomSamplingEval.js step 3 family extraction.
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const families = {};
  let files;
  try {
    files = (await readdir(DICT_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return families; // dict dir missing → stay on default lexicon
  }
  for (const f of files) {
    try {
      const data = JSON.parse(await rf(join(DICT_DIR, f), 'utf8'));
      if (!data.family || !Array.isArray(data.entries)) continue;
      if (!families[data.family]) families[data.family] = [];
      for (const entry of data.entries) {
        if (entry.term) families[data.family].push(entry.term);
        for (const sense of entry.senses || []) {
          if (sense.family && sense.family !== data.family) {
            if (!families[sense.family]) families[sense.family] = [];
            families[sense.family].push(entry.term);
          }
        }
      }
    } catch { /* skip bad file */ }
  }
  return families;
}

// --- correlation math -------------------------------------------------------
function pearsonR(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

function rank(arr) {
  // Average ranks for ties (1-based), Spearman convention.
  const sorted = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearmanRho(x, y) {
  return pearsonR(rank(x), rank(y));
}

function fisherZCi(r, n) {
  // 95% CI for Pearson r via Fisher z-transform (needs n ≥ 4).
  if (n < 4 || Math.abs(r) >= 1) return { low: NaN, high: NaN };
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const se = 1 / Math.sqrt(n - 3);
  const toR = (zz) => (Math.exp(2 * zz) - 1) / (Math.exp(2 * zz) + 1);
  return { low: toR(z - 1.96 * se), high: toR(z + 1.96 * se) };
}

// --- split + score ----------------------------------------------------------
function splitHalf(comments) {
  const sorted = [...comments].sort((a, b) => (a.time || 0) - (b.time || 0));
  const mid = Math.floor(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}

function scoreText(text) {
  return scoreComments({
    name: '', uid: '', text, source: 'splithalf',
    runtimeLexicon, analysisMode: 'hybrid',
  }).trollIndex;
}

function halfText(half) {
  return half.map((c) => c.message || c.content || '').filter(Boolean).join('\n');
}

// --- modes ------------------------------------------------------------------
async function runReal() {
  let files;
  try {
    files = (await readdir(USER_DATA_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    console.error(`No user_data at ${USER_DATA_DIR}.`);
    console.error('Run: node server/scripts/runRandomSamplingEval.js --step 2');
    console.error('Use --self-check to verify the math without data.');
    process.exit(1);
  }

  const minTotal = MIN_PER_HALF * 2;
  const pairs = [];
  let skipped = 0;
  for (const f of files) {
    const u = JSON.parse(await readFile(join(USER_DATA_DIR, f), 'utf8'));
    const comments = u.comments || [];
    if (comments.length < minTotal) { skipped++; continue; }
    const [h1, h2] = splitHalf(comments);
    const t1 = scoreText(halfText(h1));
    const t2 = scoreText(halfText(h2));
    pairs.push([t1, t2]);
  }

  if (pairs.length < 10) {
    console.error(`Only ${pairs.length} users with ≥${minTotal} comments (need ≥10 for a stable correlation). ${skipped} skipped.`);
    process.exit(1);
  }

  const x = pairs.map((p) => p[0]);
  const y = pairs.map((p) => p[1]);
  const r = pearsonR(x, y);
  const rho = spearmanRho(x, y);
  const ci = fisherZCi(r, pairs.length);

  console.log('=== Split-Half (Test-Retest) Reliability ===');
  console.log(`Users scored:   ${pairs.length}  (${skipped} skipped for < ${minTotal} comments)`);
  console.log(`Half size gate: ≥${MIN_PER_HALF} comments per half`);
  console.log(`Pearson r:      ${r.toFixed(3)}   (95% CI [${ci.low.toFixed(3)}, ${ci.high.toFixed(3)}])`);
  console.log(`Spearman ρ:     ${rho.toFixed(3)}`);
  console.log();
  if (r >= 0.7) {
    console.log('Stability: adequate (r ≥ 0.70) — composite is a usable screening snapshot.');
  } else if (r >= 0.5) {
    console.log('Stability: moderate (0.50 ≤ r < 0.70) — read as a weak snapshot, not a trait.');
  } else {
    console.log('Stability: low (r < 0.50) — a single scrape does NOT support a person-level read.');
  }
}

function runSelfCheck() {
  // Smallest thing that fails if split + correlation logic breaks.
  let fails = 0;
  const eq = (label, got, want, eps = 1e-9) => {
    const ok = Math.abs(got - want) <= eps;
    if (!ok) console.error(`  ✗ ${label}: got ${got}, want ${want}`);
    fails += ok ? 0 : 1;
  };

  // Pearson: perfect positive, perfect negative, known partial.
  eq('pearson perfect+', pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  eq('pearson perfect-', pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
  eq('pearson partial', pearsonR([1, 2, 3], [1, 2, 4]), 0.9819805, 1e-5);

  // Spearman: monotonic → 1.0; reversed → -1.0; ties handled.
  eq('spearman mono', spearmanRho([10, 20, 30, 40], [1, 2, 3, 4]), 1);
  eq('spearmon rev', spearmanRho([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  eq('spearman ties', spearmanRho([1, 1, 2, 3], [1, 1, 2, 3]), 1);

  // Fisher CI: brackets r, wider for smaller n.
  const ciBig = fisherZCi(0.8, 200);
  const ciSmall = fisherZCi(0.8, 10);
  if (!(ciBig.low < 0.8 && ciBig.high > 0.8)) { console.error('  ✗ CI(big) must bracket r'); fails++; }
  if (!(ciSmall.high - ciSmall.low > ciBig.high - ciBig.low)) { console.error('  ✗ CI must widen as n shrinks'); fails++; }

  // Split: even coverage, both halves ≥ MIN, disjoint, union == input.
  const comments = Array.from({ length: 24 }, (_, i) => ({ message: 'x', time: i }));
  const [a, b] = splitHalf(comments);
  eq('split a size', a.length, 12);
  eq('split b size', b.length, 12);
  const union = new Set([...a, ...b]);
  eq('split disjoint+cover', union.size, 24);

  if (fails === 0) {
    console.log('✓ split-half self-check passed (pearson, spearman, fisher CI, split).');
  } else {
    console.error(`✗ ${fails} self-check assertion(s) failed.`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const selfCheck = args.includes('--self-check');
const fullLexicon = args.includes('--full-lexicon');

if (selfCheck) {
  runSelfCheck();
} else {
  if (fullLexicon) {
    const families = await loadDictionaryFamilies();
    runtimeLexicon = mergeDictionaryFamilies(runtimeLexicon, families);
    const nTerms = Object.values(runtimeLexicon).reduce((s, t) => s + t.length, 0);
    console.log(`Lexicon: full (deepseek families merged), ${nTerms} terms across ${Object.keys(runtimeLexicon).length} families`);
  }
  runReal();
}
