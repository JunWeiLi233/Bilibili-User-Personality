/**
 * Feed fresh CDP-harvested corpus to DeepSeek to extract new keyword terms.
 *
 * Usage:
 *   node server/scripts/expandDictionaryFromCDPHarvest.js           # dry run
 *   EXPAND_WRITE=1 node server/scripts/expandDictionaryFromCDPHarvest.js  # merge
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const CORPUS_COMMENTS = join(PROJECT_ROOT, '.claude/corpus_harvest/corpus_comments.json');
const CORPUS_DANMAKU = join(PROJECT_ROOT, '.claude/corpus_harvest/corpus_danmaku.json');

const MAX_CHARS = Number(process.env.EXPAND_MAX_CHARS) || 25000;
const BATCH_CHARS = Number(process.env.EXPAND_BATCH_CHARS) || 5000;
const MIN_LENGTH = Number(process.env.EXPAND_MIN_COMMENT_LENGTH) || 8;
const WRITE_MODE = process.env.EXPAND_WRITE === '1';

async function loadCorpus() {
  const comments = [];

  // Load comments
  try {
    const raw = JSON.parse(await readFile(CORPUS_COMMENTS, 'utf8'));
    if (Array.isArray(raw)) {
      for (const c of raw) {
        const msg = String(c.message || '').trim();
        if (msg.length >= MIN_LENGTH) {
          comments.push({ message: msg, source: `CDP-harvest: BV${c.bvid}`, uid: c.bvid });
        }
      }
    }
  } catch (e) { console.error('Error loading comments:', e.message); }

  // Load danmaku
  try {
    const raw = JSON.parse(await readFile(CORPUS_DANMAKU, 'utf8'));
    if (Array.isArray(raw)) {
      for (const d of raw) {
        const msg = String(d.danmaku || '').trim();
        if (msg.length >= MIN_LENGTH) {
          comments.push({ message: msg, source: `CDP-harvest danmaku: BV${d.bvid}`, uid: d.bvid });
        }
      }
    }
  } catch (e) { console.error('Error loading danmaku:', e.message); }

  return comments;
}

async function main() {
  console.log('=== CDP Harvest → DeepSeek → New Terms ===\n');

  const before = await readKeywordDictionary();
  const beforeTerms = before.entries?.length || 0;
  const beforeTermSet = new Set((before.entries || []).map(e => e.term));
  console.log(`Dictionary before: ${beforeTerms} terms\n`);

  const allComments = await loadCorpus();
  console.log(`Loaded: ${allComments.length.toLocaleString()} eligible messages (${allComments.reduce((s,c) => s + c.message.length, 0).toLocaleString()} chars)\n`);

  if (allComments.length === 0) {
    console.log('No corpus to process. Run the CDP harvester first.');
    return;
  }

  // Batch into DeepSeek sized chunks
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const c of allComments) {
    if (currentChars + c.message.length > BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(c);
    currentChars += c.message.length;
  }
  if (current.length > 0) batches.push(current);

  console.log(`Batches: ${batches.length}\n`);

  let totalNew = 0;
  let totalEvidence = 0;
  const allNewTerms = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const combinedText = batch.map(c => c.message).join('\n---\n');
    const firstUid = batch[0]?.uid || 'cdp-harvest';

    console.log(`Batch ${i + 1}/${batches.length}: ${batch.length} msgs, ${combinedText.length.toLocaleString()} chars`);

    try {
      const result = await trainKeywordDictionary(
        {
          text: combinedText,
          fullText: combinedText,
          uid: firstUid,
          source: 'CDP harvest corpus',
          existingTermsOnly: false,
        },
        { write: WRITE_MODE, verbose: false },
      );

      const newTerms = (result.generatedEntries || []).filter(e => !beforeTermSet.has(e.term));
      const evidenceImproved = (result.entries || []).filter(e => beforeTermSet.has(e.term) && (e.evidenceCount || 0) > 0);

      totalNew += newTerms.length;
      totalEvidence += result.dictionaryEvidenceEntries?.length || 0;
      allNewTerms.push(...newTerms);

      const status = newTerms.length > 0
        ? `DeepSeek→${newTerms.length} new terms, ${evidenceImproved.length} existing boosted`
        : `no new terms, ${evidenceImproved.length} existing boosted`;
      console.log(`  → ${status}`);
      if (newTerms.length > 0) {
        for (const t of newTerms.slice(0, 5)) {
          console.log(`    + [${t.family}] ${t.term} — ${t.meaning || ''}`);
        }
        if (newTerms.length > 5) console.log(`    ... and ${newTerms.length - 5} more`);
      }
    } catch (e) {
      console.log(`  → ERROR: ${e.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total new terms: ${totalNew}`);
  console.log(`Evidence boosts: ${totalEvidence}`);

  const after = WRITE_MODE ? await readKeywordDictionary() : before;
  console.log(`Dictionary: ${(after.entries || []).length} terms (was ${beforeTerms})`);
  console.log(`Write mode: ${WRITE_MODE ? 'ENABLED (merged)' : 'dry run (set EXPAND_WRITE=1 to merge)'}`);
}

main().catch(console.error);
