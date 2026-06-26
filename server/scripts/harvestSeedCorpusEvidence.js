import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_RESULTS_DIR = join(__dirname, '..', '..', '.claude', 'seed_results');

import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { findLocalCorpusEvidenceEntries, flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';

async function loadAllSeedResults() {
  const files = await readdir(SEED_RESULTS_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  const results = [];
  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(await readFile(join(SEED_RESULTS_DIR, file), 'utf8'));
      results.push(data);
    } catch {
      console.warn(`Skipping unreadable: ${file}`);
    }
  }
  return results;
}

function flattenSeedResults(seedResults) {
  const comments = [];
  let totalComments = 0;
  let totalDanmaku = 0;
  let newestTs = 0;
  let oldestTs = Infinity;

  for (const seed of seedResults) {
    const seedName = seed.seed || 'unknown';
    for (const video of seed.videos || []) {
      const bvid = video.bvid || 'unknown';
      const source = `Bilibili history-tag harvest: https://www.bilibili.com/video/${bvid}/ (seed: ${seedName})`;

      // Regular comments
      for (const c of video.commentMessages || []) {
        const message = String(c.message || '').trim();
        if (!message || message.length < 2) continue;
        const ts = Number(c.time || 0);
        if (ts > 0) {
          if (ts > newestTs) newestTs = ts;
          if (ts < oldestTs) oldestTs = ts;
        }
        comments.push({
          message,
          platform: 'bilibili',
          source,
          uid: bvid,
          uname: '',
        });
        totalComments++;
      }

      // Danmaku
      for (const d of video.danmakuMessages || []) {
        const message = String(d.message || '').trim();
        if (!message || message.length < 2) continue;
        const ts = Number(d.time || 0);
        if (ts > 0) {
          if (ts > newestTs) newestTs = ts;
          if (ts < oldestTs) oldestTs = ts;
        }
        comments.push({
          message,
          platform: 'bilibili',
          source,
          uid: bvid,
          uname: '',
        });
        totalDanmaku++;
      }
    }
  }

  return { comments, totalComments, totalDanmaku, newestTs, oldestTs };
}

async function main() {
  console.log('=== Seed Corpus Evidence Harvest ===\n');

  // 1. Load all seed results
  console.log('Loading seed results...');
  const seedResults = await loadAllSeedResults();
  console.log(`  ${seedResults.length} seed result files loaded`);

  // 2. Flatten comments + danmaku
  console.log('\nFlattening comments + danmaku...');
  const { comments, totalComments, totalDanmaku, newestTs, oldestTs } = flattenSeedResults(seedResults);
  console.log(`  ${totalComments.toLocaleString()} comments`);
  console.log(`  ${totalDanmaku.toLocaleString()} danmaku`);
  console.log(`  ${comments.length.toLocaleString()} total messages`);
  if (oldestTs < Infinity) {
    console.log(`  Date range: ${new Date(oldestTs * 1000).toISOString()} → ${new Date(newestTs * 1000).toISOString()}`);
  }

  // 3. Load keyword dictionary
  console.log('\nLoading keyword dictionary...');
  const dictionary = await readKeywordDictionary();
  console.log(`  ${dictionary.entries?.length || 0} terms loaded`);

  // 4. Find evidence matches
  console.log('\nMining evidence matches...');
  const options = {
    targetEvidence: 5,           // Look for terms that still need more evidence beyond default
    maxSamplesPerTerm: 5,        // Up to 5 new samples per term
    requireCommentBackedEvidence: true,
  };
  const evidenceEntries = findLocalCorpusEvidenceEntries(dictionary, comments, options);
  console.log(`  ${evidenceEntries.length} terms matched with new evidence`);

  if (evidenceEntries.length === 0) {
    console.log('\nNo new evidence found. Dictionary already has full coverage from existing sources.');
    return;
  }

  // 5. Summary stats
  const newSamples = evidenceEntries.reduce((sum, e) => sum + (e.evidenceSamples?.length || 0), 0);
  console.log(`  ${newSamples} new evidence samples total`);

  // Show top matches by family
  const byFamily = {};
  for (const entry of evidenceEntries) {
    const f = entry.family || 'unknown';
    if (!byFamily[f]) byFamily[f] = [];
    byFamily[f].push(entry);
  }
  console.log('\nNew evidence by family:');
  for (const [family, entries] of Object.entries(byFamily).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${family}: ${entries.length} terms`);
  }

  // 6. Show sample matches
  console.log('\nSample new evidence (first 10):');
  for (const entry of evidenceEntries.slice(0, 10)) {
    console.log(`  [${entry.family}] ${entry.term}: +${entry.evidenceSamples?.length || 0} samples`);
    for (const sample of (entry.evidenceSamples || []).slice(0, 2)) {
      console.log(`    → "${sample.slice(0, 80)}${sample.length > 80 ? '...' : ''}"`);
    }
  }

  // 7. Save evidence report
  const report = {
    harvestedAt: new Date().toISOString(),
    source: 'history-tag seed corpus (.claude/seed_results/)',
    seeds: seedResults.length,
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

  const reportPath = join(__dirname, '..', 'data', 'seedCorpusHarvestReport.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport saved: ${reportPath}`);

  // 8. Merge into dictionary
  if (process.env.HARVEST_WRITE === '1') {
    console.log('\nMerging evidence into dictionary...');
    const { mergeEntriesIntoDictionary } = await import('../services/deepseekKeywordTrainer.js');
    const updated = await mergeEntriesIntoDictionary(evidenceEntries);
    console.log(`  Dictionary updated: ${updated.entries?.length || 0} total entries`);
  } else {
    console.log('\nDry run — set HARVEST_WRITE=1 to merge into dictionary.');
    console.log(`Run: HARVEST_WRITE=1 node ${fileURLToPath(import.meta.url)}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
