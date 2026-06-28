#!/usr/bin/env node
/**
 * Scoring Validation Pipeline — Per-Axis Item-Total Correlation + Sensitivity Analysis
 *
 * Computes statistical validation for the Ziegenbein 4-axis scoring system:
 *   1. Item-total correlations — does each axis contribute to the composite?
 *   2. Sensitivity analysis — rank stability under weight perturbation (Kendall's τ)
 *   3. Per-axis descriptive statistics
 *
 * Input:  personality_analysis_data_100.json (keyword match counts per user)
 * Output: server/data/scoringValidationReport.json
 *
 * References:
 *   - OECD/JRC (2008). "Handbook on Constructing Composite Indicators."
 *   - Kramer & Weldon (2022). "Constructing composite scores."
 *   - Ziegenbein et al. (2023). ACL 2023.
 *
 * NOTE: Current validation uses keyword density proxies. True label-based validation
 *       requires completed human annotations in .claude/annotation_data/labels_500.json.
 *       When labels are available, re-run for κ-grounded per-axis F1 metrics.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.cwd();
const DEFAULT_DATA = join(CWD, '.claude', 'personality_analysis_data_100.json');
const OUTPUT = join(CWD, 'server', 'data', 'scoringValidationReport.json');

// ——— 6-axis → 4-axis mapping (Ziegenbein) ———
const AXIS_MAP = {
  attack: 'toxicEmotions',
  absolutes: 'missingIntelligibility',
  evasion: 'missingCommitment',
  evidence: 'missingIntelligibility',   // inverse — evidence reduces missingIntelligibility
  cooperation: 'missingCommitment',     // inverse — cooperation reduces missingCommitment
  correction: 'missingCommitment',      // inverse — correction reduces missingCommitment
};

const AXIS_LABEL = {
  toxicEmotions: '情绪过激',
  missingCommitment: '回避讨论',
  missingIntelligibility: '逻辑混乱',
  otherReasons: '其他问题',
};

// ——— Baseline weights (current system, corpus-derived) ———
const BASELINE_WEIGHTS = {
  toxicEmotions: 0.28,
  missingCommitment: 0.25,
  missingIntelligibility: 0.27,
  otherReasons: 0.20,
};

// ——— Helpers ———
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1); }
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(arr.length, 1));
}
function sum(arr) { return arr.reduce((s, v) => s + v, 0); }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

// ——— Kendall's τ-b (rank correlation) ———
function kendallTau(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length;
  let concordant = 0, discordant = 0;
  let tiesA = 0, tiesB = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = a[i] - a[j];
      const db = b[i] - b[j];
      if (da === 0) tiesA++;
      if (db === 0) tiesB++;
      if (da * db > 0) concordant++;
      else if (da * db < 0) discordant++;
    }
  }
  const totalPairs = n * (n - 1) / 2;
  const denom = Math.sqrt((totalPairs - tiesA) * (totalPairs - tiesB));
  if (denom === 0) return null;
  return (concordant - discordant) / denom;
}

// ——— Pearson correlation ———
function pearsonR(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = mean(x), my = mean(y);
  const sx = std(x), sy = std(y);
  if (sx === 0 || sy === 0) return null;
  return x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) / (x.length * sx * sy);
}

// ——— Load & transform ———
function loadUserData(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const analyses = raw.analyses || raw;
  const users = [];
  for (const [uid, data] of Object.entries(analyses)) {
    if (!data || typeof data !== 'object') continue;
    const axes = data.axes || data;
    const totalMsgs = data.totalMessages || 1;

    // Map 6-axis keyword counts → 4-axis densities
    const toxicEmotions = ((axes.attack || 0) / totalMsgs) * 100;
    const missingCommitment =
      clamp(((axes.evasion || 0) * 1.2 - (axes.cooperation || 0) * 0.5 - (axes.correction || 0) * 0.7) / totalMsgs * 100 + 35, 0, 100);
    const missingIntelligibility =
      clamp(((axes.absolutes || 0) * 1.1 - (axes.evidence || 0) * 0.6) / totalMsgs * 100 + 40, 0, 100);
    const otherReasons = clamp((((axes.attack || 0) + (axes.absolutes || 0) + (axes.evasion || 0)) / totalMsgs) * 4, 0, 100);

    const scores = {
      toxicEmotions: Math.round(toxicEmotions),
      missingCommitment: Math.round(missingCommitment),
      missingIntelligibility: Math.round(missingIntelligibility),
      otherReasons: Math.round(otherReasons),
    };

    const composite = Object.entries(scores).reduce(
      (s, [k, v]) => s + v * (BASELINE_WEIGHTS[k] || 0.25), 0
    );

    users.push({ uid, totalMsgs, axes: scores, composite: Math.round(composite) });
  }
  return users;
}

// ——— 1. Item-Total Correlations ———
function itemTotalCorrelations(users) {
  const N = users.length;
  if (N < 10) return { error: `Insufficient data: ${N} users (need ≥10)` };

  const axisNames = Object.keys(AXIS_LABEL);
  const perAxis = {};
  const correctedTotal = {}; // item-rest correlation

  // Per-axis raw values
  const axisValues = {};
  for (const ax of axisNames) {
    axisValues[ax] = users.map((u) => u.axes[ax] || 0);
  }

  // Composite score (using baseline weights)
  const composites = users.map((u) => u.composite);

  for (const ax of axisNames) {
    const vals = axisValues[ax];

    // Item-total r
    const r = pearsonR(vals, composites);

    // Corrected item-total (remove this axis from composite)
    const otherAxes = axisNames.filter((a) => a !== ax);
    const correctedComposites = users.map((u) =>
      otherAxes.reduce((s, a) => s + (u.axes[a] || 0) * (BASELINE_WEIGHTS[a] || 0.25), 0) /
      otherAxes.reduce((s, a) => s + (BASELINE_WEIGHTS[a] || 0.25), 0) * 100
    );
    const rCorrected = pearsonR(vals, correctedComposites);

    // Descriptive stats
    perAxis[ax] = {
      label: AXIS_LABEL[ax],
      n: N,
      mean: Math.round(mean(vals) * 100) / 100,
      std: Math.round(std(vals) * 100) / 100,
      p25: Math.round(percentile(vals, 25)),
      p50: Math.round(percentile(vals, 50)),
      p75: Math.round(percentile(vals, 75)),
      itemTotalR: r !== null ? Math.round(r * 1000) / 1000 : null,
      correctedItemTotalR: rCorrected !== null ? Math.round(rCorrected * 1000) / 1000 : null,
      interpretation: !r ? 'insufficient_data' :
        Math.abs(r) >= 0.6 ? 'strong_contributor' :
        Math.abs(r) >= 0.4 ? 'moderate_contributor' :
        Math.abs(r) >= 0.2 ? 'weak_contributor' : 'negligible',
    };
  }

  return perAxis;
}

// ——— 2. Sensitivity Analysis ———
function sensitivityAnalysis(users) {
  const axisNames = Object.keys(AXIS_LABEL);
  const N = users.length;
  if (N < 10) return { error: `Insufficient data: ${N} users (need ≥10)` };

  // Baseline rankings
  const baselineComposite = users.map((u) => u.composite);
  const baselineRanks = rankArray(baselineComposite);

  // Perturbation levels: ±5%, ±10%, ±20%, ±30%
  const perturbations = [0.05, 0.10, 0.20, 0.30];

  const results = [];

  for (const ax of axisNames) {
    const baseW = BASELINE_WEIGHTS[ax] || 0.25;
    const axisResults = { axis: ax, label: AXIS_LABEL[ax], baseWeight: baseW, perturbations: [] };

    for (const pct of perturbations) {
      for (const dir of ['+', '-']) {
        const delta = dir === '+' ? pct : -pct;
        const perturbedW = clamp(baseW * (1 + delta), 0.05, 0.95);

        // Renormalize other weights proportionally
        const otherAxes = axisNames.filter((a) => a !== ax);
        const otherSum = otherAxes.reduce((s, a) => s + (BASELINE_WEIGHTS[a] || 0.25), 0);
        const perturbedWeights = { ...BASELINE_WEIGHTS, [ax]: perturbedW };
        for (const oa of otherAxes) {
          perturbedWeights[oa] = (BASELINE_WEIGHTS[oa] || 0.25) * ((1 - perturbedW) / otherSum);
        }

        // Recompute composites with perturbed weights
        const perturbedComposite = users.map((u) =>
          axisNames.reduce((s, a) => s + (u.axes[a] || 0) * perturbedWeights[a], 0)
        );
        const perturbedRanks = rankArray(perturbedComposite);

        // Kendall's τ between baseline and perturbed rankings
        const tau = kendallTau(baselineRanks, perturbedRanks);

        // Maximum rank displacement
        const displacements = baselineRanks.map((r, i) => Math.abs(r - perturbedRanks[i]));
        const maxDisplacement = Math.max(...displacements);
        const meanDisplacement = mean(displacements);

        axisResults.perturbations.push({
          direction: dir,
          percentChange: Math.round(pct * 100),
          newWeight: Math.round(perturbedW * 1000) / 1000,
          kendallTau: tau !== null ? Math.round(tau * 1000) / 1000 : null,
          maxRankDisplacement: maxDisplacement,
          meanRankDisplacement: Math.round(meanDisplacement * 100) / 100,
        });
      }
    }

    // Stability grade: average τ across all perturbations
    const taus = axisResults.perturbations.map((p) => p.kendallTau).filter(Boolean);
    const avgTau = taus.length > 0 ? mean(taus) : null;
    axisResults.stability = avgTau !== null ?
      (avgTau >= 0.95 ? 'very_high' : avgTau >= 0.90 ? 'high' : avgTau >= 0.80 ? 'moderate' : 'low') :
      'unknown';
    axisResults.meanKendallTau = avgTau !== null ? Math.round(avgTau * 1000) / 1000 : null;

    results.push(axisResults);
  }

  return results;
}

function rankArray(arr) {
  // Rank: 1 = largest value
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => b.v - a.v);
  const ranks = new Array(arr.length);
  for (let r = 0; r < indexed.length; r++) {
    ranks[indexed[r].i] = r + 1;
  }
  return ranks;
}

// ——— 3. Per-axis correlation matrix ———
function correlationMatrix(users) {
  const axisNames = Object.keys(AXIS_LABEL);
  const matrix = {};
  for (const ax1 of axisNames) {
    matrix[ax1] = {};
    const vals1 = users.map((u) => u.axes[ax1] || 0);
    for (const ax2 of axisNames) {
      const vals2 = users.map((u) => u.axes[ax2] || 0);
      const r = pearsonR(vals1, vals2);
      matrix[ax1][ax2] = r !== null ? Math.round(r * 1000) / 1000 : null;
    }
  }
  return matrix;
}

// ——— Main ———
function main() {
  const dataPath = process.argv[2] || DEFAULT_DATA;
  console.log(`Loading user data from: ${dataPath}`);

  let users;
  try {
    users = loadUserData(dataPath);
  } catch (e) {
    console.error(`ERROR loading data: ${e.message}`);
    process.exit(1);
  }

  console.log(`Loaded ${users.length} users for validation`);

  if (users.length < 10) {
    console.warn(`WARNING: Only ${users.length} users — item-total correlations and sensitivity analysis need ≥10 for meaningful results.`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataSource: dataPath,
    userCount: users.length,
    note: users.length < 10
      ? `Low sample size (${users.length} users). Results are illustrative, not statistically robust. Re-run with ≥100 annotated users for reliable metrics.`
      : null,

    // 1. Baseline weights (corpus-derived, provenance documented)
    baselineWeights: BASELINE_WEIGHTS,
    weightProvenance: {
      toxicEmotions: 'Corpus keyword density factor for attack-family terms (highest frequency family, 966 terms)',
      missingCommitment: 'Derived from evasion/correction/cooperation density balance in 25,753-comment corpus',
      missingIntelligibility: 'Derived from absolutes/evidence density ratio; absolutes = strongest single-family predictor',
      otherReasons: 'Residual category; captures unclassified discourse issues not fitting the 3 primary axes',
      method: 'Corpus-derived keyword density baselines from 179,628 messages (25,753 comments + 153,875 danmaku). Pending label-trained logistic regression weights once .claude/annotation_data/labels_500.json has ≥2 human annotators per comment.',
    },

    // 2. Item-total correlations
    itemTotalCorrelations: itemTotalCorrelations(users),

    // 3. Correlation matrix
    axisCorrelationMatrix: correlationMatrix(users),

    // 4. Sensitivity analysis
    sensitivityAnalysis: sensitivityAnalysis(users),

    // 5. Composite descriptive statistics
    compositeStats: {
      n: users.length,
      mean: Math.round(mean(users.map((u) => u.composite)) * 100) / 100,
      std: Math.round(std(users.map((u) => u.composite)) * 100) / 100,
      p25: percentile(users.map((u) => u.composite), 25),
      p50: percentile(users.map((u) => u.composite), 50),
      p75: percentile(users.map((u) => u.composite), 75),
    },
  };

  writeFileSync(OUTPUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Validation report written to: ${OUTPUT}`);

  // Print summary
  console.log('\n=== Scoring Validation Summary ===');
  console.log(`Users: ${users.length}`);
  console.log(`\nBaseline weights:`);
  for (const [ax, w] of Object.entries(BASELINE_WEIGHTS)) {
    console.log(`  ${AXIS_LABEL[ax]} (${ax}): ${w}`);
  }
  console.log(`\nPer-axis descriptive stats:`);
  const itc = report.itemTotalCorrelations;
  if (typeof itc === 'object' && !itc.error) {
    for (const [ax, data] of Object.entries(itc)) {
      const flag = data.interpretation === 'weak_contributor' || data.interpretation === 'negligible' ? ' ⚠' : '';
      console.log(`  ${data.label}: μ=${data.mean} σ=${data.std} r_item-total=${data.itemTotalR} (${data.interpretation})${flag}`);
    }
  } else if (itc && itc.error) {
    console.log(`  ${itc.error}`);
  }
  console.log(`\nComposite: μ=${report.compositeStats.mean} σ=${report.compositeStats.std} P50=${report.compositeStats.p50}`);
  console.log(`\nFull report: ${OUTPUT}`);
}

main();
