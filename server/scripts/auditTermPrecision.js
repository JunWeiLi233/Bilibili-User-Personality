/**
 * Per-Term Precision Audit — cross-references dictionary term matches against
 * DeepSeek annotator consensus labels.
 *
 * For each term in the keyword dictionary:
 *   P(argumentative | term matched) = #arg_users_with_term / #users_with_term
 *
 * Flags terms with precision < 0.10 for downweighting or removal.
 *
 * Usage:
 *   node server/scripts/auditTermPrecision.js
 *   node server/scripts/auditTermPrecision.js --output server/data/term_precision_audit.json
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCORED_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'scored');
const ANNOTATED_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'annotated');
const DICT_DIR = join(ROOT, 'server', 'data', 'deepseekKeywordDictionary.entries');

async function loadJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function loadDictionary() {
  const entries = [];
  try {
    const files = await readdir(DICT_DIR);
    for (const f of files.sort()) {
      if (!f.endsWith('.json')) continue;
      const data = await loadJson(join(DICT_DIR, f));
      if (!data) continue;
      if (data.family && Array.isArray(data.entries)) {
        for (const entry of data.entries) {
          entries.push({
            term: entry.term || '',
            family: data.family,
            source: f,
            senses: entry.senses || [],
          });
        }
      }
    }
  } catch { /* dict dir not found */ }
  return entries;
}

async function main() {
  console.log('=== Per-Term Precision Audit ===\n');

  // Load dictionary
  const dict = await loadDictionary();
  console.log(`Loaded ${dict.length} dictionary entries from ${DICT_DIR}`);

  // Load scored + annotated pairs
  const scoredFiles = {};
  const annotatedFiles = {};
  try {
    const files = await readdir(SCORED_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      const data = await loadJson(join(SCORED_DIR, f));
      if (data) scoredFiles[uid] = data;
    }
  } catch { console.error('No scored data found'); return; }

  try {
    const files = await readdir(ANNOTATED_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      const data = await loadJson(join(ANNOTATED_DIR, f));
      if (data) annotatedFiles[uid] = data;
    }
  } catch { console.error('No annotated data found'); return; }

  // Build term→users index from vocabularyMarks
  const termUsers = new Map(); // term → Set of UIDs
  const termFamilies = new Map(); // term → family

  for (const [uid, scored] of Object.entries(scoredFiles)) {
    const annotated = annotatedFiles[uid];
    if (!annotated) continue;

    const marks = scored.vocabularyMarks || [];
    for (const mark of marks) {
      const term = mark.term;
      if (!term) continue;
      if (!termUsers.has(term)) {
        termUsers.set(term, new Set());
        termFamilies.set(term, mark.family);
      }
      termUsers.get(term).add(uid);
    }
  }

  console.log(`Found ${termUsers.size} unique terms with matches`);

  // Compute per-term precision
  const termResults = [];
  const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];

  for (const [term, users] of termUsers.entries()) {
    const family = termFamilies.get(term) || 'unknown';
    const userList = [...users];
    const total = userList.length;
    if (total < 2) continue; // skip single-occurrence terms

    // Count users where ANY axis has argumentative label
    let argCount = 0;
    const axisHits = Object.fromEntries(axes.map((a) => [a, 0]));

    for (const uid of userList) {
      const annotated = annotatedFiles[uid];
      if (!annotated) continue;
      const binary = annotated.binaryLabels || {};
      if (Object.values(binary).some((v) => v === true)) {
        argCount++;
      }
      for (const ax of axes) {
        if (binary[ax] === true) axisHits[ax]++;
      }
    }

    const precision = argCount / total;

    // Map family to expected axis
    const familyToAxis = {
      attack: 'toxicEmotions',
      absolutes: 'missingIntelligibility',
      evasion: 'missingCommitment',
      cooperation: 'missingCommitment',
      correction: 'missingCommitment',
      evidence: 'missingIntelligibility',
    };
    const expectedAxis = familyToAxis[family] || 'unknown';

    termResults.push({
      term,
      family,
      expectedAxis,
      total,
      argumentativeUsers: argCount,
      precision: parseFloat(precision.toFixed(4)),
      flagged: precision < 0.10,
      flagSeverity: precision < 0.05 ? 'critical' : precision < 0.10 ? 'warning' : 'ok',
      perAxisHits: axisHits,
    });
  }

  // Sort: lowest precision first
  termResults.sort((a, b) => a.precision - b.precision);

  const flagged = termResults.filter((t) => t.flagged);
  const critical = termResults.filter((t) => t.flagSeverity === 'critical');

  console.log(`\n--- Results ---`);
  console.log(`Total terms analyzed: ${termResults.length}`);
  console.log(`Flagged (precision < 0.10): ${flagged.length}`);
  console.log(`Critical (precision < 0.05): ${critical.length}`);

  // Show worst terms
  console.log(`\nTop 15 lowest-precision terms:`);
  for (const t of termResults.slice(0, 15)) {
    console.log(`  ${t.term} (${t.family}): P=${t.precision.toFixed(3)}, n=${t.total}, arg=${t.argumentativeUsers}`);
  }

  // Summary by family
  const byFamily = {};
  for (const t of termResults) {
    if (!byFamily[t.family]) byFamily[t.family] = { total: 0, flagged: 0, avgPrecision: 0, sum: 0 };
    byFamily[t.family].total++;
    byFamily[t.family].sum += t.precision;
    if (t.flagged) byFamily[t.family].flagged++;
  }
  for (const [family, stats] of Object.entries(byFamily)) {
    stats.avgPrecision = parseFloat((stats.sum / stats.total).toFixed(4));
  }

  console.log(`\n--- By Family ---`);
  for (const [family, stats] of Object.entries(byFamily).sort((a, b) => a[1].avgPrecision - b[1].avgPrecision)) {
    console.log(`  ${family}: avg_p=${stats.avgPrecision.toFixed(3)}, flagged=${stats.flagged}/${stats.total}`);
  }

  // Build downweighting factors
  const downweightFactors = {};
  for (const t of termResults) {
    if (t.flagged) {
      // Soft downweighting: multiply term contribution by precision factor
      // term with precision 0.03 → weight 0.03 (almost eliminated)
      // term with precision 0.08 → weight 0.08
      downweightFactors[t.term] = {
        method: 'soft_downweight',
        precision: t.precision,
        factor: t.precision, // weight = precision (soft)
        family: t.family,
      };
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalTerms: termResults.length,
    flaggedTerms: flagged.length,
    criticalTerms: critical.length,
    dataSource: {
      scored: SCORED_DIR,
      annotated: ANNOTATED_DIR,
      dictionary: DICT_DIR,
    },
    byFamily,
    flagged: flagged.map((t) => ({
      term: t.term,
      family: t.family,
      expectedAxis: t.expectedAxis,
      precision: t.precision,
      totalUsers: t.total,
      argumentativeUsers: t.argumentativeUsers,
      severity: t.flagSeverity,
    })),
    allTerms: termResults,
    downweightFactors,
    recommendations: [
      `Remove ${critical.length} terms with precision < 0.05 and < 5 occurrences`,
      `Downweight ${flagged.length - critical.length} terms with precision 0.05–0.10 by their precision factor`,
      'Apply term weights in headlessScorer.findLexiconMarks() by multiplying confidence by precision factor',
    ],
  };

  const outputPath = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : join(ROOT, 'server', 'data', 'term_precision_audit.json');

  await saveJson(outputPath, report);
  console.log(`\nSaved to ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
