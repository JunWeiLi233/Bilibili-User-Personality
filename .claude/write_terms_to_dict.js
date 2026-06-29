/**
 * Direct write: append generated terms to the split-format dictionary.
 * Reads existing shards, adds new terms, writes back.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DATA_DIR = join(PROJECT_ROOT, 'server', 'data');
const DICT_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json');
const DRY_RUN = process.env.DRY_RUN === '1';

// Shard size limit
const SHARD_MAX_BYTES = 65536;

function estimateEntryBytes(entry) {
  return JSON.stringify(entry).length + 2; // +2 for comma/newline
}

async function main() {
  // Load existing dictionary manifest
  const dict = JSON.parse(await readFile(DICT_PATH, 'utf8'));
  const termsReport = JSON.parse(await readFile(join(DATA_DIR, 'allGeneratedTerms.json'), 'utf8'));
  const newTerms = termsReport.terms || [];

  console.log(`Existing dict: ${Object.values(dict.entryFiles).flat().length} entry shards`);
  console.log(`New terms to add: ${newTerms.length}`);

  // Count existing terms per family from shards
  const existingTerms = new Set();
  for (const [family, files] of Object.entries(dict.entryFiles)) {
    for (const file of files) {
      try {
        const data = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8'));
        for (const term of Object.keys(data)) {
          existingTerms.add(term);
        }
      } catch(e) {}
    }
  }
  console.log(`Existing unique terms: ${existingTerms.size}`);

  // Filter to truly new terms
  const toAdd = newTerms.filter(t => !existingTerms.has(t.term));
  console.log(`Actually new terms: ${toAdd.length}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN - no writes');
    const byFamily = {};
    for (const t of toAdd) {
      byFamily[t.family] = (byFamily[t.family] || 0) + 1;
    }
    console.log('New terms by family:', byFamily);
    return;
  }

  // Group new terms by family
  const newByFamily = {};
  for (const t of toAdd) {
    if (!newByFamily[t.family]) newByFamily[t.family] = [];
    newByFamily[t.family].push(t);
  }

  // For each family, load existing shards and append
  const updatedManifest = { ...dict, entryFiles: { ...dict.entryFiles }, evidenceFiles: { ...dict.evidenceFiles } };

  for (const [family, terms] of Object.entries(newByFamily)) {
    console.log(`\n${family}: adding ${terms.length} terms`);

    // Get existing shard files for this family
    const existingFiles = [...(dict.entryFiles[family] || [])];
    const evidenceFiles = [...(dict.evidenceFiles[family] || [])];

    // Load last shard
    let lastShardPath = existingFiles.length > 0 ? existingFiles[existingFiles.length - 1] : null;
    let lastShard = {};
    let lastShardSize = 0;

    if (lastShardPath) {
      try {
        const raw = await readFile(join(DATA_DIR, lastShardPath), 'utf8');
        lastShard = JSON.parse(raw);
        lastShardSize = Buffer.byteLength(raw, 'utf8');
      } catch(e) {}
    }

    for (const term of terms) {
      const entrySize = estimateEntryBytes(term);
      if (lastShardSize + entrySize > SHARD_MAX_BYTES) {
        // Write current shard and create new one
        const shardNum = existingFiles.length + 1;
        const shardName = `${family}-${String(shardNum).padStart(3, '0')}.json`;
        const shardPath = `deepseekKeywordDictionary.entries/${shardName}`;
        await writeFile(join(DATA_DIR, shardPath), JSON.stringify(lastShard, null, 2), 'utf8');
        console.log(`  Wrote shard: ${shardPath} (${Object.keys(lastShard).length} terms, ${lastShardSize} bytes)`);
        existingFiles.push(shardPath);
        lastShard = {};
        lastShardSize = 0;
      }
      lastShard[term.term] = {
        family: term.family,
        meaning: term.meaning,
        risk: term.risk,
        confidence: term.confidence,
        variants: [],
        evidenceSamples: [],
        evidenceSources: [],
        updatedAt: new Date().toISOString(),
      };
      lastShardSize += entrySize;
    }

    // Write final shard
    if (Object.keys(lastShard).length > 0) {
      const shardNum = existingFiles.length + 1;
      const shardName = `${family}-${String(shardNum).padStart(3, '0')}.json`;
      const shardPath = `deepseekKeywordDictionary.entries/${shardName}`;
      await writeFile(join(DATA_DIR, shardPath), JSON.stringify(lastShard, null, 2), 'utf8');
      console.log(`  Wrote shard: ${shardPath} (${Object.keys(lastShard).length} terms, ${lastShardSize} bytes)`);
      existingFiles.push(shardPath);
    }

    // Also create empty evidence shards for each new entry shard
    for (const shardPath of existingFiles) {
      if (!evidenceFiles.includes(shardPath.replace('entries', 'evidence'))) {
        evidenceFiles.push(shardPath.replace('entries', 'evidence'));
      }
    }

    updatedManifest.entryFiles[family] = existingFiles;
    updatedManifest.evidenceFiles[family] = evidenceFiles;
  }

  // Update manifest
  updatedManifest.updatedAt = new Date().toISOString();
  await writeFile(DICT_PATH, JSON.stringify(updatedManifest, null, 2), 'utf8');
  console.log(`\nManifest updated: ${DICT_PATH}`);

  // Verify
  const verify = JSON.parse(await readFile(DICT_PATH, 'utf8'));
  let verifyTotal = 0;
  const verifyByFamily = {};
  for (const [family, files] of Object.entries(verify.entryFiles)) {
    let fc = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8'));
        fc += Object.keys(data).length;
      } catch(e) {}
    }
    verifyByFamily[family] = fc;
    verifyTotal += fc;
  }
  console.log(`\n=== Verification ===`);
  console.log(`Total terms: ${verifyTotal}`);
  console.log(`By family:`, verifyByFamily);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
