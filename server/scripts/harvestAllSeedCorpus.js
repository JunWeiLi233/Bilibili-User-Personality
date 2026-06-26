/**
 * Round 4: Re-harvest evidence from ALL accumulated seed result directories.
 *
 * Reads from:
 *   1. .claude/seed_results/        (original, 196 files)
 *   2. .claude/seed_results_deep/   (round 1 — if exists)
 *   3. .claude/seed_results_batch2/ (round 2 — if exists)
 *   4. .claude/seed_results_batch3/ (round 3 — if exists)
 *
 * Flattens all comments + danmaku, mines against keyword dictionary,
 * merges new evidence, runs coverage audit.
 *
 * Usage:
 *   node server/scripts/harvestAllSeedCorpus.js          # dry run
 *   HARVEST_WRITE=1 node server/scripts/harvestAllSeedCorpus.js  # merge
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const SOURCE_DIRS = [
  '.claude/seed_results',
  '.claude/seed_results_deep',
  '.claude/seed_results_batch2',
  '.claude/seed_results_batch3',
];

import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { findLocalCorpusEvidenceEntries } from '../services/localCorpusEvidence.js';

async function loadResultsFromDir(relPath) {
  const absPath = join(PROJECT_ROOT, relPath);
  const results = [];
  try {
    const files = await readdir(absPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    for (const file of jsonFiles) {
      try {
        const data = JSON.parse(await readFile(join(absPath, file), 'utf8'));
        if (data.seed && Array.isArray(data.videos)) results.push(data);
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return results;
}

function flattenAllResults(allResults, dirLabel) {
  const comments = [];
  let totalComments = 0;
  let totalDanmaku = 0;
  let newestTs = 0;
  let oldestTs = Infinity;

  for (const seed of allResults) {
    const seedName = seed.seed || 'unknown';
    for (const video of seed.videos || []) {
      if (video.error) continue;
      const bvid = video.bvid || 'unknown';
      const source = `Bilibili history-tag harvest (${dirLabel}): https://www.bilibili.com/video/${bvid}/ (seed: ${seedName})`;

      for (const c of video.commentMessages || []) {
        const message = String(c.message || '').trim();
        if (!message || message.length < 2) continue;
        const ts = Number(c.time || 0);
        if (ts > 0) { if (ts > newestTs) newestTs = ts; if (ts < oldestTs) oldestTs = ts; }
        comments.push({ message, platform: 'bilibili', source, uid: bvid, uname: '' });
        totalComments++;
      }

      for (const d of video.danmakuMessages || []) {
        const message = String(d.message || '').trim();
        if (!message || message.length < 2) continue;
        const ts = Number(d.time || 0);
        if (ts > 0) { if (ts > newestTs) newestTs = ts; if (ts < oldestTs) oldestTs = ts; }
        comments.push({ message, platform: 'bilibili', source, uid: bvid, uname: '' });
        totalDanmaku++;
      }
    }
  }

  return { comments, totalComments, totalDanmaku, newestTs, oldestTs };
}

async function main() {
  console.log('=== Round 4: Multi-Source Evidence Re-Harvest ===\n');

  // 1. Load all source directories
  const allResults = [];
  for (const dir of SOURCE_DIRS) {
    const results = await loadResultsFromDir(dir);
    if (results.length > 0) {
      console.log(`  ${dir}: ${results.length} seed files`);
      allResults.push(...results);
    } else {
      console.log(`  ${dir}: (empty or not found)`);
    }
  }
  console.log(`  Total: ${allResults.length} seed result files\n`);

  // 2. Flatten
  console.log('Flattening comments + danmaku...');
  const { comments, totalComments, totalDanmaku, newestTs, oldestTs } = flattenAllResults(allResults, 'multi-round');
  console.log(`  ${totalComments.toLocaleString()} comments`);
  console.log(`  ${totalDanmaku.toLocaleString()} danmaku`);
  console.log(`  ${comments.length.toLocaleString()} total messages`);
  if (oldestTs < Infinity) {
    console.log(`  Date range: ${new Date(oldestTs * 1000).toISOString()} → ${new Date(newestTs * 1000).toISOString()}`);
  }

  // 3. Load dictionary
  console.log('\nLoading keyword dictionary...');
  const dictionary = await readKeywordDictionary();
  console.log(`  ${dictionary.entries?.length || 0} terms`);

  // 4. Mine evidence
  console.log('\nMining evidence matches...');
  const options = {
    targetEvidence: 5,
    maxSamplesPerTerm: 5,
    requireCommentBackedEvidence: true,
  };
  const evidenceEntries = findLocalCorpusEvidenceEntries(dictionary, comments, options);
  console.log(`  ${evidenceEntries.length} terms matched with new evidence`);

  if (evidenceEntries.length === 0) {
    console.log('\nNo new evidence found. Dictionary already fully covered.');
    return;
  }

  const newSamples = evidenceEntries.reduce((sum, e) => sum + (e.evidenceSamples?.length || 0), 0);
  console.log(`  ${newSamples} new evidence samples\n`);

  // 5. By family
  const byFamily = {};
  for (const entry of evidenceEntries) {
    const f = entry.family || 'unknown';
    if (!byFamily[f]) byFamily[f] = [];
    byFamily[f].push(entry);
  }
  console.log('New evidence by family:');
  for (const [family, entries] of Object.entries(byFamily).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${family}: ${entries.length} terms`);
  }

  // 6. Sample matches
  console.log('\nSample new evidence:');
  for (const entry of evidenceEntries.slice(0, 10)) {
    console.log(`  [${entry.family}] ${entry.term}: +${entry.evidenceSamples?.length || 0} samples`);
    for (const sample of (entry.evidenceSamples || []).slice(0, 2)) {
      console.log(`    → "${sample.slice(0, 80)}${sample.length > 80 ? '...' : ''}"`);
    }
  }

  // 7. Save report
  const report = {
    harvestedAt: new Date().toISOString(),
    source: 'multi-round deep scrape (seed_results + seed_results_deep + batch2 + batch3)',
    sourceFiles: allResults.length,
    totalComments,
    totalDanmaku,
    totalMessages: comments.length,
    dateRange: oldestTs < Infinity ? {
      oldest: new Date(oldestTs * 1000).toISOString(),
      newest: new Date(newestTs * 1000).toISOString(),
    } : null,
    matchedTerms: evidenceEntries.length,
    newEvidenceSamples: newSamples,
    byFamily: Object.fromEntries(
      Object.entries(byFamily).map(([f, entries]) => [f, entries.length])
    ),
    entries: evidenceEntries.map(e => ({
      term: e.term,
      family: e.family,
      newSamples: e.evidenceSamples?.length || 0,
      samples: e.evidenceSamples || [],
    })),
  };

  const reportPath = join(__dirname, '..', 'data', 'seedCorpusHarvestReportR4.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport saved: ${reportPath}`);

  // 8. Merge
  if (process.env.HARVEST_WRITE === '1') {
    console.log('\nMerging evidence into dictionary...');
    const { mergeEntriesIntoDictionary } = await import('../services/deepseekKeywordTrainer.js');
    const updated = await mergeEntriesIntoDictionary(evidenceEntries);
    console.log(`  Dictionary updated: ${updated.entries?.length || 0} total entries`);
  } else {
    console.log('\nDry run — set HARVEST_WRITE=1 to merge.');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
