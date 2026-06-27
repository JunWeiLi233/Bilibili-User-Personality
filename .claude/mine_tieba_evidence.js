/**
 * Mine Tieba corpus comments for dictionary term matches and add evidence.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE_DIR = 'server/data/deepseekKeywordDictionary.evidence';
const ENTRIES_DIR = 'server/data/deepseekKeywordDictionary.entries';

// Load all dictionary terms with their families
console.log('Loading dictionary entries...');
const entryFiles = readdirSync(ENTRIES_DIR).filter(f => f.endsWith('.json'));

const termToFamily = new Map();
const termToExistingEvidence = new Map();
let totalTerms = 0;

for (const file of entryFiles) {
  const entries = JSON.parse(readFileSync(join(ENTRIES_DIR, file), 'utf8'));
  for (const entry of (entries.entries || entries || [])) {
    const term = entry.term || entry.name || '';
    const family = entry.family || file.split('-')[0];
    if (term) {
      termToFamily.set(term, family);
      termToExistingEvidence.set(term, new Set(
        (entry.evidenceSamples || entry.evidence || []).map(s => (s?.message || s || '').toLowerCase().trim())
      ));
      totalTerms++;
    }
  }
}
console.log(`Loaded ${totalTerms} terms across ${termToFamily.size} unique terms`);

// Load Tieba corpus comments
console.log('Loading Tieba corpus...');
const tiebaIndex = JSON.parse(readFileSync('server/data/tiebaKeywordCorpus.json', 'utf8'));
const allComments = [];

for (const cf of (tiebaIndex.commentFiles || [])) {
  const shard = JSON.parse(readFileSync(join('server/data', cf), 'utf8'));
  allComments.push(...(shard.comments || []));
}
console.log(`Loaded ${allComments.length} Tieba comments`);

// Match comments against terms
console.log('Matching terms...');
const newEvidence = new Map(); // term -> [samples]

for (const comment of allComments) {
  const msg = (comment.message || '').toLowerCase().trim();
  if (!msg) continue;

  for (const [term, family] of termToFamily) {
    if (msg.includes(term.toLowerCase())) {
      if (!newEvidence.has(term)) newEvidence.set(term, new Set());
      const existing = termToExistingEvidence.get(term) || new Set();
      if (!existing.has(msg)) {
        newEvidence.get(term).add((comment.message || '').trim());
      }
    }
  }
}

console.log(`Found new evidence for ${newEvidence.size} terms`);
let totalNew = 0;
for (const [term, samples] of newEvidence) {
  console.log(`  ${term}: ${samples.size} new samples`);
  totalNew += samples.size;
}
console.log(`Total new evidence samples: ${totalNew}`);

// Merge into evidence files
console.log('\nMerging into evidence files...');
const evidenceFiles = readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json'));

// Build family -> evidence entries map
const familyEvidence = {};
for (const file of evidenceFiles) {
  const family = file.split('-')[0];
  const data = JSON.parse(readFileSync(join(EVIDENCE_DIR, file), 'utf8'));
  familyEvidence[family] = familyEvidence[family] || [];
  familyEvidence[family].push({ file, data });
}

for (const [term, samples] of newEvidence) {
  const family = termToFamily.get(term);
  if (!family) { console.log(`  WARN: no family for term "${term}"`); continue; }

  const files = familyEvidence[family];
  if (!files) { console.log(`  WARN: no evidence files for family "${family}"`); continue; }

  // Find or create entry
  let found = false;
  for (const { file, data } of files) {
    for (const entry of (data.evidence || [])) {
      if (entry.term === term) {
        const existing = new Set(entry.evidenceSamples || []);
        const toAdd = [...samples].filter(s => !existing.has(s));
        if (toAdd.length > 0) {
          entry.evidenceSamples.push(...toAdd);
          entry.evidenceSources.push(`Tieba browser harvest: ${toAdd.length} new samples on ${new Date().toISOString()}`);
          writeFileSync(join(EVIDENCE_DIR, file), JSON.stringify(data, null, 2), 'utf8');
          console.log(`  Updated ${file}: ${term} +${toAdd.length}`);
        }
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    // Append to first file for this family
    const { file, data } = files[0];
    data.evidence.push({
      term,
      evidenceSamples: [...samples],
      evidenceSources: [`Tieba browser harvest: ${samples.size} samples on ${new Date().toISOString()}`],
    });
    writeFileSync(join(EVIDENCE_DIR, file), JSON.stringify(data, null, 2), 'utf8');
    console.log(`  Added to ${file}: ${term} +${samples.size}`);
  }
}

console.log('\nDone. Run "npm run dictionary:coverage" to regenerate audit.');
