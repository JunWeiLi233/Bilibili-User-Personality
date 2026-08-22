/**
 * Feed browser-harness harvested Bilibili comments to DeepSeek for keyword evidence.
 *
 * Unlike mineLocalCorpusEvidence.js (exact substring match), this uses DeepSeek
 * semantic analysis via trainKeywordDictionary() to find contextual evidence.
 *
 * Usage:
 *   node server/scripts/expandBrowserCorpus.js              # dry run
 *   EXPAND_WRITE=1 node server/scripts/expandBrowserCorpus.js  # merge into dictionary
 *
 * Env knobs:
 *   BILIBILI_BROWSER_CORPUS — path to browser-harvested corpus (default server/data/bilibiliBrowserCorpus.json)
 *   EXPAND_MAX_CHARS       — max chars to send to DeepSeek (default 20000)
 *   EXPAND_BATCH_CHARS     — chars per DeepSeek call (default 4000)
 *   EXPAND_MIN_LENGTH      — skip comments shorter than this (default 8)
 *   EXPAND_TARGET_WEAK     — only process terms with < N evidence (default 3)
 *   EXPAND_WRITE           — set to '1' to merge evidence into dictionary
 *   EXPAND_EXISTING_ONLY   — set to '1' for evidence only, '0' to also generate new terms (default '1')
 *   EXPAND_ZERO_ONLY       — set to '1' to ONLY target zero-evidence terms (default '1')
 */

import { readFile } from 'node:fs/promises';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

// ── Config ──────────────────────────────────────────────────────
const CORPUS_PATH = process.env.BILIBILI_BROWSER_CORPUS || 'server/data/bilibiliBrowserCorpus.json';
const MAX_CHARS = Number(process.env.EXPAND_MAX_CHARS) || 20000;
const BATCH_CHARS = Number(process.env.EXPAND_BATCH_CHARS) || 4000;
const MIN_LENGTH = Number(process.env.EXPAND_MIN_LENGTH) || 8;
const WRITE_MODE = process.env.EXPAND_WRITE === '1';
const EXISTING_ONLY = process.env.EXPAND_EXISTING_ONLY !== '0';
const ZERO_ONLY = process.env.EXPAND_ZERO_ONLY !== '0';
const TARGET_WEAK = Number(process.env.EXPAND_TARGET_WEAK) || 3;
const VERBOSE = process.env.EXPAND_VERBOSE !== '0';

// ── Load zero-evidence terms ─────────────────────────────────────
async function loadZeroEvidenceTerms(beforeDict) {
  // Read ALL zero-evidence terms from the dictionary, not just the audit sample
  const entries = Array.isArray(beforeDict?.entries) ? beforeDict.entries : [];
  return entries
    .filter(e => (e.evidenceCount || 0) === 0)
    .map(e => String(e.term || '').trim())
    .filter(Boolean);
}

// ── Load ─────────────────────────────────────────────────────────
async function loadBrowserCorpus() {
  try {
    const raw = await readFile(CORPUS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.error('Corpus is not an array');
      return [];
    }
    return data
      .filter(c => {
        const msg = String(c?.message || '').trim();
        return msg.length >= MIN_LENGTH;
      })
      .map(c => ({
        message: String(c.message || '').trim(),
        source: String(c.source || 'Bilibili browser harvest'),
        uid: String(c.bvid || c.uid || ''),
      }));
  } catch (e) {
    console.error('Failed to load corpus:', e.message);
    return [];
  }
}

// ── Sample diverse ──────────────────────────────────────────────
function sampleDiverse(comments, maxChars) {
  // De-duplicate by message
  const seen = new Set();
  const uniq = comments.filter(c => {
    const key = c.message.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by length desc — longer comments have richer keyword material
  uniq.sort((a, b) => b.message.length - a.message.length);

  const sampled = [];
  let total = 0;
  for (const c of uniq) {
    if (total + c.message.length > maxChars) continue;
    sampled.push(c);
    total += c.message.length;
  }
  return sampled;
}

// ── Batch ───────────────────────────────────────────────────────
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
  console.log('=== Browser Corpus → DeepSeek → Dictionary Evidence ===\n');

  // 1. Load dictionary
  const before = await readKeywordDictionary();
  const beforeTerms = before.entries?.length || 0;
  const weakBefore = (before.entries || []).filter(e => (e.evidenceCount || 0) < TARGET_WEAK).length;
  const zeroBefore = (before.entries || []).filter(e => (e.evidenceCount || 0) === 0).length;
  console.log(`Dictionary: ${beforeTerms} terms, ${weakBefore} weak (<${TARGET_WEAK}), ${zeroBefore} zero\n`);

  // 2. Load corpus
  console.log(`Loading: ${CORPUS_PATH}`);
  const allComments = await loadBrowserCorpus();
  console.log(`  Total: ${allComments.length.toLocaleString()} eligible (≥${MIN_LENGTH} chars)\n`);

  if (allComments.length === 0) {
    console.log('No comments to process.');
    return;
  }

  // 2.5 Load zero-evidence terms for targeting
  let targetExistingTerms = [];
  if (ZERO_ONLY) {
    targetExistingTerms = await loadZeroEvidenceTerms(before);
    console.log(`Zero-evidence terms to target: ${targetExistingTerms.length}`);
    if (targetExistingTerms.length === 0) {
      console.log('No zero-evidence terms — nothing to do!');
      return;
    }
    console.log();
  }

  // Split zero-evidence terms into groups of 30 (DeepSeek prompt limit per batch)
  const TERMS_PER_BATCH = 30;
  const termGroups = [];
  for (let g = 0; g < targetExistingTerms.length; g += TERMS_PER_BATCH) {
    termGroups.push(targetExistingTerms.slice(g, g + TERMS_PER_BATCH));
  }
  if (ZERO_ONLY) {
    console.log(`Term groups: ${termGroups.length} (≤${TERMS_PER_BATCH} terms each)\n`);
  }

  // 3. Sample
  console.log(`Sampling up to ${MAX_CHARS.toLocaleString()} chars...`);
  const sampled = sampleDiverse(allComments, MAX_CHARS);
  const sampledChars = sampled.reduce((s, c) => s + c.message.length, 0);
  console.log(`  Sampled: ${sampled.length} comments, ${sampledChars.toLocaleString()} chars\n`);

  // 4. Batch
  const batches = batchComments(sampled, BATCH_CHARS);
  console.log(`Batches: ${batches.length} (≤${BATCH_CHARS.toLocaleString()} chars each)\n`);

  // 5. Process — iterate over term groups, then batches within each group
  let totalEvidence = 0;
  let totalNew = 0;
  const errors = [];
  const targetGroups = ZERO_ONLY ? termGroups : [targetExistingTerms];

  for (let g = 0; g < targetGroups.length; g++) {
    const termSlice = targetGroups[g];
    if (ZERO_ONLY && targetGroups.length > 1) {
      console.log(`── Term group ${g + 1}/${targetGroups.length}: ${termSlice.length} terms ──`);
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const combinedText = batch.map(c => c.message).join('\n---\n');
      const firstUid = batch[0]?.uid || '';
      const firstSource = batch[0]?.source || 'Bilibili browser harvest';

      const label = ZERO_ONLY && targetGroups.length > 1
        ? `  Batch ${i + 1}/${batches.length}`
        : `Batch ${i + 1}/${batches.length}`;
      console.log(`${label}: ${batch.length} comments, ${combinedText.length.toLocaleString()} chars...`);

      try {
        const result = await trainKeywordDictionary(
          {
            text: combinedText,
            fullText: combinedText,
            uid: firstUid,
            source: firstSource,
            existingTermsOnly: EXISTING_ONLY,
          },
          {
            write: WRITE_MODE,
            verbose: VERBOSE,
            targetEvidence: TARGET_WEAK,
            targetExistingTerms: termSlice.length > 0 ? termSlice : undefined,
          },
        );

        const evidenceEntries = result.dictionaryEvidenceEntries || [];
        const newTerms = (result.generatedEntries || []).filter(
          e => !before.entries?.some(be => be.term === e.term),
        );

        totalEvidence += evidenceEntries.length;
        totalNew += newTerms.length;

        if (VERBOSE && evidenceEntries.length > 0) {
          const sample = evidenceEntries.slice(0, 5).map(e => `[${e.family}] ${e.term}`).join(', ');
          console.log(`    → ${evidenceEntries.length} evidence: ${sample}${evidenceEntries.length > 5 ? '...' : ''}`);
        } else if (evidenceEntries.length > 0) {
          console.log(`    → ${evidenceEntries.length} evidence, ${newTerms.length} new terms`);
        }

        if (newTerms.length > 0) {
          for (const t of newTerms.slice(0, 3)) {
            console.log(`      + [${t.family}] ${t.term} — ${t.meaning || '?'}`);
          }
        }
      } catch (e) {
        console.error(`    → ERROR: ${e.message}`);
        errors.push({ group: g + 1, batch: i + 1, error: e.message });
      }

      // Pause between batches
      if (i < batches.length - 1 || g < targetGroups.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  // 6. Report
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total evidence matches: ${totalEvidence}`);
  console.log(`Total new terms:       ${totalNew}`);
  console.log(`Errors:                ${errors.length}`);

  const after = await readKeywordDictionary();
  const afterWeak = (after.entries || []).filter(e => (e.evidenceCount || 0) < TARGET_WEAK).length;
  const afterZero = (after.entries || []).filter(e => (e.evidenceCount || 0) === 0).length;
  console.log(`\nWeak (<${TARGET_WEAK}): ${weakBefore} → ${afterWeak} (Δ ${weakBefore - afterWeak})`);
  console.log(`Zero evidence:    ${zeroBefore} → ${afterZero} (Δ ${zeroBefore - afterZero})`);

  if (!WRITE_MODE) {
    console.log('\n⚠  DRY RUN — set EXPAND_WRITE=1 to merge.');
    console.log('  EXPAND_WRITE=1 node server/scripts/expandBrowserCorpus.js');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
