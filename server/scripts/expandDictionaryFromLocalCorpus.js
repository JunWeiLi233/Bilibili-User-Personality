/**
 * Expand keyword dictionary by feeding local corpus comments to DeepSeek
 * for NEW term generation (not just evidence for existing terms).
 *
 * Usage:
 *   node server/scripts/expandDictionaryFromLocalCorpus.js              # dry run
 *   EXPAND_WRITE=1 node server/scripts/expandDictionaryFromLocalCorpus.js  # merge into dictionary
 *
 * Env knobs:
 *   EXPAND_MAX_CHARS — max chars of comment text to send (default 30000, ~600 comments)
 *   EXPAND_BATCH_CHARS — chars per DeepSeek call (default 5000, fits max_tokens=900 budget)
 *   EXPAND_MIN_COMMENT_LENGTH — skip comments shorter than this (default 10)
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const SOURCE_DIRS = [
  '.claude/seed_results',
  '.claude/seed_results_deep',
  '.claude/seed_results_batch2',
  '.claude/seed_results_batch3',
];

import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

// ── Config ──────────────────────────────────────────────────────
const MAX_CHARS = Number(process.env.EXPAND_MAX_CHARS) || 30000;
const BATCH_CHARS = Number(process.env.EXPAND_BATCH_CHARS) || 5000;
const MIN_COMMENT_LENGTH = Number(process.env.EXPAND_MIN_COMMENT_LENGTH) || 10;
const WRITE_MODE = process.env.EXPAND_WRITE === '1';
const VERBOSE = process.env.EXPAND_VERBOSE !== '0';

// ── Load all seed results ───────────────────────────────────────
async function loadAllComments() {
  const comments = [];
  for (const dir of SOURCE_DIRS) {
    const absPath = join(PROJECT_ROOT, dir);
    let files;
    try {
      files = await readdir(absPath);
    } catch {
      if (VERBOSE) console.log(`  ${dir}: (not found)`);
      continue;
    }
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    let dirComments = 0;
    for (const file of jsonFiles) {
      try {
        const data = JSON.parse(await readFile(join(absPath, file), 'utf8'));
        if (!data.seed || !Array.isArray(data.videos)) continue;
        for (const video of data.videos) {
          if (video.error) continue;
          const bvid = video.bvid || 'unknown';
          const source = `Bilibili history-tag harvest: https://www.bilibili.com/video/${bvid}/ (seed: ${data.seed})`;
          for (const c of video.commentMessages || []) {
            const msg = String(c.message || '').trim();
            if (msg.length >= MIN_COMMENT_LENGTH) {
              comments.push({ message: msg, source, uid: bvid });
              dirComments++;
            }
          }
          for (const d of video.danmakuMessages || []) {
            const msg = String(d.message || '').trim();
            if (msg.length >= MIN_COMMENT_LENGTH) {
              comments.push({ message: msg, source, uid: bvid });
              dirComments++;
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
    if (VERBOSE) console.log(`  ${dir}: ${dirComments.toLocaleString()} comments`);
  }
  return comments;
}

// ── Sample diverse comments ─────────────────────────────────────
function sampleDiverse(comments, maxChars) {
  // Sort by length desc (longer comments = richer keyword material)
  // then sample evenly across seeds for diversity
  const bySeed = {};
  for (const c of comments) {
    const seed = c.source.match(/seed:\s*([^)]+)/)?.[1] || 'unknown';
    if (!bySeed[seed]) bySeed[seed] = [];
    bySeed[seed].push(c);
  }

  // Sort each seed's comments by length desc
  for (const seed of Object.keys(bySeed)) {
    bySeed[seed].sort((a, b) => b.message.length - a.message.length);
  }

  // Round-robin across seeds, taking the longest remaining from each
  const seeds = Object.keys(bySeed).sort();
  const indices = Object.fromEntries(seeds.map(s => [s, 0]));
  const sampled = [];
  let totalChars = 0;

  while (totalChars < maxChars) {
    let added = false;
    for (const seed of seeds) {
      const pool = bySeed[seed];
      const idx = indices[seed];
      if (idx >= pool.length) continue;
      const c = pool[idx];
      if (totalChars + c.message.length > maxChars) continue;
      sampled.push(c);
      totalChars += c.message.length;
      indices[seed] = idx + 1;
      added = true;
    }
    if (!added) break; // all seeds exhausted or remaining comments too long
  }

  return sampled;
}

// ── Batch comments into DeepSeek-sized chunks ──────────────────
function batchComments(comments, batchChars) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const c of comments) {
    if (currentChars + c.message.length > batchChars && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(c);
    currentChars += c.message.length;
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('=== Dictionary Expansion: Local Corpus → DeepSeek → New Terms ===\n');

  // 1. Load dictionary before
  const before = await readKeywordDictionary();
  const beforeTerms = before.entries?.length || 0;
  const beforeTermSet = new Set((before.entries || []).map(e => e.term));
  console.log(`Dictionary before: ${beforeTerms} terms\n`);

  // 2. Load all comments
  console.log('Loading local corpus...');
  const allComments = await loadAllComments();
  console.log(`  Total: ${allComments.length.toLocaleString()} eligible comments\n`);

  // 3. Sample diverse comments
  console.log(`Sampling up to ${MAX_CHARS.toLocaleString()} chars of diverse comments...`);
  const sampled = sampleDiverse(allComments, MAX_CHARS);
  const sampledChars = sampled.reduce((s, c) => s + c.message.length, 0);
  console.log(`  Sampled: ${sampled.length} comments, ${sampledChars.toLocaleString()} chars\n`);

  // 4. Batch into DeepSeek-sized chunks
  const batches = batchComments(sampled, BATCH_CHARS);
  console.log(`Batches: ${batches.length} (${BATCH_CHARS.toLocaleString()} chars each)\n`);

  // 5. Process each batch
  let totalGenerated = 0;
  let totalEvidence = 0;
  const allGeneratedTerms = [];
  const errors = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const combinedText = batch.map(c => c.message).join('\n---\n');
    const firstUid = batch[0]?.uid || 'local-corpus';
    const firstSource = batch[0]?.source || 'local-corpus';

    console.log(`Batch ${i + 1}/${batches.length}: ${batch.length} comments, ${combinedText.length.toLocaleString()} chars`);

    try {
      const result = await trainKeywordDictionary(
        {
          text: combinedText,
          fullText: combinedText,
          uid: firstUid,
          source: firstSource,
          existingTermsOnly: false, // ← KEY: generate NEW terms
        },
        {
          write: WRITE_MODE,
          verbose: false,
        },
      );

      const rawGenerated = (result.generatedEntries || []).length;
      const dupesGenerated = (result.generatedEntries || []).filter(
        e => beforeTermSet.has(e.term),
      ).length;
      const newTerms = (result.generatedEntries || []).filter(
        e => !beforeTermSet.has(e.term),
      );

      // Evidence improvements: entries that strengthened existing terms
      const evidenceImproved = (result.entries || []).filter(
        e => beforeTermSet.has(e.term) && (e.evidenceCount || 0) > 0,
      );

      totalGenerated += newTerms.length;
      totalEvidence += result.dictionaryEvidenceEntries?.length || 0;
      allGeneratedTerms.push(...newTerms);

      const status = rawGenerated > 0
        ? `DeepSeek→${rawGenerated} terms (${dupesGenerated} known), ${evidenceImproved.length} evidence boosts, ${newTerms.length} new`
        : `no novel expressions, ${evidenceImproved.length} evidence boosts`;

      console.log(`  → ${status}`);
      if (newTerms.length > 0) {
        for (const t of newTerms.slice(0, 5)) {
          console.log(`    + [${t.family}] ${t.term} — ${t.meaning || '(no meaning)'}`);
        }
        if (newTerms.length > 5) console.log(`    ... and ${newTerms.length - 5} more`);
      }
      if (evidenceImproved.length > 0 && VERBOSE) {
        const byFam = {};
        for (const t of evidenceImproved) {
          byFam[t.family] = (byFam[t.family] || 0) + 1;
        }
        const summary = Object.entries(byFam).map(([f, n]) => `${f}+${n}`).join(', ');
        if (summary) console.log(`    boosted: ${summary}`);
      }
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
      errors.push({ batch: i + 1, error: e.message });
    }

    // Brief pause between batches to avoid rate limits
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 6. Report
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total new terms generated: ${totalGenerated}`);
  console.log(`Total evidence matches:   ${totalEvidence}`);
  console.log(`Errors: ${errors.length}`);

  // Show unique new terms by family
  const byFamily = {};
  for (const t of allGeneratedTerms) {
    const f = t.family || 'unknown';
    if (!byFamily[f]) byFamily[f] = new Set();
    byFamily[f].add(t.term);
  }
  console.log('\nNew terms by family:');
  for (const [family, terms] of Object.entries(byFamily).sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${family}: ${terms.size} terms — ${[...terms].slice(0, 8).join(', ')}${terms.size > 8 ? '...' : ''}`);
  }

  // 7. Load dictionary after
  const after = await readKeywordDictionary();
  console.log(`\nDictionary: ${beforeTerms} → ${after.entries?.length || 0} terms (Δ ${(after.entries?.length || 0) - beforeTerms})`);

  if (!WRITE_MODE) {
    console.log('\n⚠ DRY RUN — set EXPAND_WRITE=1 to merge into dictionary.');
    console.log(`  EXPAND_WRITE=1 node server/scripts/expandDictionaryFromLocalCorpus.js`);
  }

  // Save report
  const report = {
    generatedAt: new Date().toISOString(),
    writeMode: WRITE_MODE,
    totalComments: allComments.length,
    sampledComments: sampled.length,
    sampledChars,
    batches: batches.length,
    newTermsTotal: totalGenerated,
    evidenceMatchesTotal: totalEvidence,
    newTermsByFamily: Object.fromEntries(
      Object.entries(byFamily).map(([f, terms]) => [f, [...terms]])
    ),
    errors,
  };
  const reportPath = join(__dirname, '..', 'data', 'dictionaryExpansionReport.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport: ${reportPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
