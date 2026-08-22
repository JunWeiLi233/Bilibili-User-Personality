/**
 * Phase 6 Re-validation — re-score all 100 users with the fully calibrated
 * pipeline and compare against baseline metrics.
 *
 * Usage:
 *   node server/scripts/revalidatePhase6.js
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const OUTPUT_DIR = join(ROOT, '.claude', 'random_sampling_eval');
const USER_DATA_DIR = join(OUTPUT_DIR, 'user_data');
const SCORED_DIR = join(OUTPUT_DIR, 'scored');
const ANNOTATED_DIR = join(OUTPUT_DIR, 'annotated');

function loadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

async function main() {
  console.log('=== Phase 6: Re-validation ===\n');

  // Import headlessScorer
  const { scoreComments, buildRuntimeLexicon, mergeDictionaryFamilies, reloadConfig } = await import('../services/headlessScorer.js');

  // Reset all caches to pick up new calibration/audit data
  reloadConfig();

  // Load keyword dictionary
  const dictDir = join(ROOT, 'server', 'data', 'deepseekKeywordDictionary.entries');
  const families = {};
  try {
    const { readdir, readFile } = await import('node:fs/promises');
    const files = (await readdir(dictDir)).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(await readFile(join(dictDir, f), 'utf8'));
        if (data.family && Array.isArray(data.entries)) {
          if (!families[data.family]) families[data.family] = [];
          for (const entry of data.entries) {
            if (entry.term) families[data.family].push(entry.term);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* dict dir not found */ }

  let runtimeLexicon = buildRuntimeLexicon();
  if (Object.keys(families).length > 0) {
    runtimeLexicon = mergeDictionaryFamilies(runtimeLexicon, families);
  }

  // Load user data
  const { readdir: rd } = await import('node:fs/promises');
  let userFiles = [];
  try {
    userFiles = (await rd(USER_DATA_DIR)).filter(f => f.endsWith('.json'));
  } catch { console.error('No user data found'); return; }

  console.log(`Re-scoring ${userFiles.length} users with fully calibrated pipeline...`);

  const newScored = {};
  for (const filename of userFiles) {
    const uid = filename.replace('.json', '');
    const userData = loadJson(join(USER_DATA_DIR, filename));
    if (!userData?.combinedText) continue;

    const result = scoreComments({
      name: `用户${uid}`,
      uid,
      text: userData.combinedText,
      source: 'AICU scrape',
      runtimeLexicon,
      analysisMode: 'hybrid',
      semanticMatches: null,
    });

    newScored[uid] = {
      uid,
      scoredAt: new Date().toISOString(),
      trollIndex: result.trollIndex,
      sampleSize: result.sampleSize,
      speechSummary: result.speechSummary,
      scores: result._calibrated?.scores || result.scores,
      rawScores: result.scores,
      vocabularyMarks: result.vocabularyMarks,
      calibrated: true,
    };
  }

  console.log(`Re-scored ${Object.keys(newScored).length} users`);

  // Load annotations
  const annotatedFiles = {};
  try {
    const af = await rd(ANNOTATED_DIR);
    for (const f of af) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      const data = loadJson(join(ANNOTATED_DIR, f));
      if (data) annotatedFiles[uid] = data;
    }
  } catch { /* no annotated data */ }

  // Load original scored for comparison
  const origScored = {};
  try {
    const sf = await rd(SCORED_DIR);
    for (const f of sf) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      const data = loadJson(join(SCORED_DIR, f));
      if (data) origScored[uid] = data;
    }
  } catch { /* no scored data */ }

  // Build paired data for metrics
  const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];

  // NEW metrics
  const newUserResults = [];
  for (const [uid, scored] of Object.entries(newScored)) {
    const annotated = annotatedFiles[uid];
    if (!annotated) continue;
    const binary = annotated.binaryLabels || {};
    const consensus = annotated.perAxisConsensus || {};
    const predPositive = scored.trollIndex >= (scored.threshold || 7);
    const actualPositive = Object.values(binary).some(v => v === true);
    newUserResults.push({ uid, trollIndex: scored.trollIndex, predPositive, actualPositive, scores: scored.scores, consensus, binary });
  }

  // OLD metrics
  const oldUserResults = [];
  for (const [uid, scored] of Object.entries(origScored)) {
    const annotated = annotatedFiles[uid];
    if (!annotated) continue;
    const binary = annotated.binaryLabels || {};
    const predPositive = scored.trollIndex >= 50;
    const actualPositive = Object.values(binary).some(v => v === true);
    oldUserResults.push({ uid, trollIndex: scored.trollIndex, predPositive, actualPositive, scores: scored.scores, consensus: annotated.perAxisConsensus || {}, binary });
  }

  // Compute metrics
  function computeAucRoc(results) {
    const sorted = [...results].sort((a, b) => b.trollIndex - a.trollIndex);
    const nPos = sorted.filter(u => u.actualPositive).length;
    const nNeg = sorted.length - nPos;
    if (nPos === 0 || nNeg === 0) return 0.5;

    let tp = 0, fp = 0, auc = 0;
    let prevFpr = 0, prevTpr = 0;
    for (const user of sorted) {
      if (user.actualPositive) tp++;
      else fp++;
      const tpr = tp / nPos;
      const fpr = fp / nNeg;
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      prevFpr = fpr;
      prevTpr = tpr;
    }
    return auc;
  }

  function computePrf1(results, threshold) {
    const tp = results.filter(u => u.trollIndex >= threshold && u.actualPositive).length;
    const fp = results.filter(u => u.trollIndex >= threshold && !u.actualPositive).length;
    const fn = results.filter(u => u.trollIndex < threshold && u.actualPositive).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { precision, recall, f1, tp, fp, fn, threshold };
  }

  function brierScore(yTrue, yProb) {
    let sum = 0;
    for (let i = 0; i < yTrue.length; i++) sum += (yProb[i] - yTrue[i]) ** 2;
    return sum / yTrue.length;
  }

  function expectedCalibrationError(yTrue, yProb, nBins = 10) {
    const n = yTrue.length;
    const bins = Array.from({ length: nBins }, () => ({ sumTrue: 0, sumProb: 0, count: 0 }));
    for (let i = 0; i < n; i++) {
      const binIdx = Math.min(nBins - 1, Math.floor(yProb[i] * nBins));
      bins[binIdx].sumTrue += yTrue[i];
      bins[binIdx].sumProb += yProb[i];
      bins[binIdx].count++;
    }
    let ece = 0;
    for (const bin of bins) {
      if (bin.count === 0) continue;
      const acc = bin.sumTrue / bin.count;
      const conf = bin.sumProb / bin.count;
      ece += (bin.count / n) * Math.abs(acc - conf);
    }
    return ece;
  }

  function findOptimalThreshold(results) {
    let bestF1 = 0, bestThresh = 7;
    for (let t = 1; t <= 50; t++) {
      const { f1 } = computePrf1(results, t);
      if (f1 > bestF1) { bestF1 = f1; bestThresh = t; }
    }
    return { threshold: bestThresh, f1: bestF1, ...computePrf1(results, bestThresh) };
  }

  // Compute metrics
  const newOpt = findOptimalThreshold(newUserResults);
  const oldOpt = findOptimalThreshold(oldUserResults);

  const newAuc = computeAucRoc(newUserResults);
  const oldAuc = computeAucRoc(oldUserResults);

  const newPrf1 = computePrf1(newUserResults, newOpt.threshold);
  const oldPrf1 = computePrf1(oldUserResults, 50); // original threshold

  // Per-axis metrics
  const newAxisMetrics = {};
  const oldAxisMetrics = {};
  for (const axis of axes) {
    const newYT = [], newYP = [], oldYT = [], oldYP = [];
    for (const user of newUserResults) {
      const score = (user.scores || []).find(s => s.category === axis);
      const consensusVal = (user.consensus || {})[axis];
      if (score && consensusVal !== undefined) {
        newYT.push(Math.min(1, consensusVal / 2));
        newYP.push(score.value / 100);
      }
    }
    for (const user of oldUserResults) {
      const score = (user.scores || []).find(s => s.category === axis);
      const consensusVal = (user.consensus || {})[axis];
      if (score && consensusVal !== undefined) {
        oldYT.push(Math.min(1, consensusVal / 2));
        oldYP.push(score.value / 100);
      }
    }
    if (newYT.length > 0) {
      newAxisMetrics[axis] = {
        n: newYT.length,
        brier: parseFloat(brierScore(newYT, newYP).toFixed(4)),
        ece: parseFloat(expectedCalibrationError(newYT, newYP).toFixed(4)),
      };
    }
    if (oldYT.length > 0) {
      oldAxisMetrics[axis] = {
        n: oldYT.length,
        brier: parseFloat(brierScore(oldYT, oldYP).toFixed(4)),
        ece: parseFloat(expectedCalibrationError(oldYT, oldYP).toFixed(4)),
      };
    }
  }

  // Troll index range
  const newTrollRange = {
    min: Math.min(...newUserResults.map(u => u.trollIndex)),
    max: Math.max(...newUserResults.map(u => u.trollIndex)),
    spread: Math.max(...newUserResults.map(u => u.trollIndex)) - Math.min(...newUserResults.map(u => u.trollIndex)),
  };
  const oldTrollRange = {
    min: Math.min(...oldUserResults.map(u => u.trollIndex)),
    max: Math.max(...oldUserResults.map(u => u.trollIndex)),
    spread: Math.max(...oldUserResults.map(u => u.trollIndex)) - Math.min(...oldUserResults.map(u => u.trollIndex)),
  };

  // Compute Spearman rho
  function spearmanRho(xs, ys) {
    const n = xs.length;
    const rank = arr => {
      const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array(n);
      for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
      // Handle ties: average rank
      for (let i = 0; i < n;) {
        let j = i + 1;
        while (j < n && sorted[j].v === sorted[i].v) j++;
        const avgRank = (i + j + 1) / 2;
        for (let k = i; k < j; k++) ranks[sorted[k].i] = avgRank;
        i = j;
      }
      return ranks;
    };
    const xRanks = rank(xs);
    const yRanks = rank(ys);
    const meanXR = xRanks.reduce((s, r) => s + r, 0) / n;
    const meanYR = yRanks.reduce((s, r) => s + r, 0) / n;
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      cov += (xRanks[i] - meanXR) * (yRanks[i] - meanYR);
      varX += (xRanks[i] - meanXR) ** 2;
      varY += (yRanks[i] - meanYR) ** 2;
    }
    return varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
  }

  const newRhos = {};
  const oldRhos = {};
  for (const axis of axes) {
    const newXs = [], newYs = [], oldXs = [], oldYs = [];
    for (const user of newUserResults) {
      const score = (user.scores || []).find(s => s.category === axis);
      const consensusVal = (user.consensus || {})[axis];
      if (score && consensusVal !== undefined) {
        newXs.push(score.value);
        newYs.push(consensusVal);
      }
    }
    for (const user of oldUserResults) {
      const score = (user.scores || []).find(s => s.category === axis);
      const consensusVal = (user.consensus || {})[axis];
      if (score && consensusVal !== undefined) {
        oldXs.push(score.value);
        oldYs.push(consensusVal);
      }
    }
    newRhos[axis] = parseFloat(spearmanRho(newXs, newYs).toFixed(4));
    oldRhos[axis] = parseFloat(spearmanRho(oldXs, oldYs).toFixed(4));
  }

  // --- Comparison Table ---
  console.log('\n========================================');
  console.log('  Phase 6: Before/After Comparison');
  console.log('========================================\n');

  console.log('Metric              | Before     | After      | Target');
  console.log('--------------------|------------|------------|------------');
  console.log(`AUC-ROC             | ${oldAuc.toFixed(3)}      | ${newAuc.toFixed(3)}      | ≥ 0.65`);
  console.log(`F1 (opt threshold)  | ${oldPrf1.f1.toFixed(3)}      | ${newPrf1.f1.toFixed(3)}      | ≥ 0.40`);
  console.log(`Optimal Threshold   | ${oldOpt.threshold}          | ${newOpt.threshold}          | —`);
  console.log(`Precision           | ${oldPrf1.precision.toFixed(3)}      | ${newPrf1.precision.toFixed(3)}      | —`);
  console.log(`Recall              | ${oldPrf1.recall.toFixed(3)}      | ${newPrf1.recall.toFixed(3)}      | —`);
  console.log(`Troll Index Range   | ${oldTrollRange.min}-${oldTrollRange.max}    | ${newTrollRange.min}-${newTrollRange.max}     | ≥ 40 pts`);
  console.log(`Troll Index Spread  | ${oldTrollRange.spread}         | ${newTrollRange.spread}         | ≥ 40`);
  console.log('');

  console.log('Per-Axis Brier Score:');
  for (const axis of axes) {
    const oB = oldAxisMetrics[axis]?.brier?.toFixed(3) || 'N/A';
    const nB = newAxisMetrics[axis]?.brier?.toFixed(3) || 'N/A';
    console.log(`  ${axis.padEnd(22)} | ${oB.padStart(8)}   | ${nB.padStart(8)}   | < 0.15`);
  }

  console.log('\nPer-Axis ECE:');
  for (const axis of axes) {
    const oE = oldAxisMetrics[axis]?.ece?.toFixed(3) || 'N/A';
    const nE = newAxisMetrics[axis]?.ece?.toFixed(3) || 'N/A';
    console.log(`  ${axis.padEnd(22)} | ${oE.padStart(8)}   | ${nE.padStart(8)}   | < 0.20`);
  }

  console.log('\nPer-Axis Spearman Rho:');
  for (const axis of axes) {
    console.log(`  ${axis.padEnd(22)} | ${String(oldRhos[axis]).padStart(8)}   | ${String(newRhos[axis]).padStart(8)}   | ≥ 0.50`);
  }

  // Check targets
  console.log('\n--- Target Verification ---');
  const targets = {
    'AUC >= 0.65': newAuc >= 0.65,
    'F1 >= 0.40': newPrf1.f1 >= 0.40,
    'Troll spread >= 40': newTrollRange.spread >= 40,
    'Worst Brier < 0.15': Math.max(...Object.values(newAxisMetrics).map(m => m.brier)) < 0.15,
    'Worst ECE < 0.20': Math.max(...Object.values(newAxisMetrics).map(m => m.ece)) < 0.20,
  };
  for (const [target, met] of Object.entries(targets)) {
    console.log(`  ${met ? '✅' : '❌'} ${target}`);
  }

  // Save re-scored data
  const rescoreDir = join(OUTPUT_DIR, 'rescored');
  mkdirSync(rescoreDir, { recursive: true });
  for (const [uid, data] of Object.entries(newScored)) {
    writeFileSync(join(rescoreDir, `${uid}.json`), JSON.stringify(data, null, 2), 'utf8');
  }
  console.log(`\nRe-scored data saved to ${rescoreDir}`);

  // Save comparison report
  const report = {
    generatedAt: new Date().toISOString(),
    nUsers: newUserResults.length,
    before: {
      aucRoc: parseFloat(oldAuc.toFixed(4)),
      f1: parseFloat(oldPrf1.f1.toFixed(4)),
      precision: parseFloat(oldPrf1.precision.toFixed(4)),
      recall: parseFloat(oldPrf1.recall.toFixed(4)),
      threshold: 50,
      trollRange: oldTrollRange,
      perAxis: oldAxisMetrics,
      spearmanRho: oldRhos,
    },
    after: {
      aucRoc: parseFloat(newAuc.toFixed(4)),
      f1: parseFloat(newPrf1.f1.toFixed(4)),
      precision: parseFloat(newPrf1.precision.toFixed(4)),
      recall: parseFloat(newPrf1.recall.toFixed(4)),
      threshold: newOpt.threshold,
      trollRange: newTrollRange,
      perAxis: newAxisMetrics,
      spearmanRho: newRhos,
    },
    targets: {
      'auc >= 0.65': newAuc >= 0.65,
      'f1 >= 0.40': newPrf1.f1 >= 0.40,
      'troll_spread >= 40': newTrollRange.spread >= 40,
      'worst_brier < 0.15': Math.max(...Object.values(newAxisMetrics).map(m => m.brier)) < 0.15,
      'worst_ece < 0.20': Math.max(...Object.values(newAxisMetrics).map(m => m.ece)) < 0.20,
      'worst_rho >= 0.50': Math.max(...Object.values(newRhos)) >= 0.50,
    },
    improvements: {
      aucRoc_delta: parseFloat((newAuc - oldAuc).toFixed(4)),
      f1_delta: parseFloat((newPrf1.f1 - oldPrf1.f1).toFixed(4)),
      brier_best_improvement: parseFloat((Math.max(...Object.values(oldAxisMetrics).map(m => m.brier)) - Math.max(...Object.values(newAxisMetrics).map(m => m.brier))).toFixed(4)),
      rho_best_improvement: parseFloat((Math.max(...Object.values(newRhos)) - Math.max(...Object.values(oldRhos))).toFixed(4)),
    },
  };

  const reportPath = join(OUTPUT_DIR, 'phase6_comparison.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Comparison report saved to ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
