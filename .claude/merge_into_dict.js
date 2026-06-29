/**
 * Merge generated terms into the split-format keyword dictionary.
 * Usage: node .claude/merge_into_dict.js
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  // Dynamic import to avoid ESM issues with the trainer
  const { mergeEntriesIntoDictionary, readKeywordDictionary } = await import('../server/services/deepseekKeywordTrainer.js');

  // Load generated terms
  const termsPath = join(PROJECT_ROOT, 'server', 'data', 'allGeneratedTerms.json');
  const report = JSON.parse(await readFile(termsPath, 'utf8'));
  const terms = report.terms || [];

  console.log(`Loaded ${terms.length} terms to merge`);
  console.log(`By family:`, report.byFamily);

  // Check current dictionary size
  const before = await readKeywordDictionary();
  console.log(`Dictionary before: ${Object.keys(before).length} terms`);

  if (DRY_RUN) {
    console.log('\nDRY RUN - not writing');
    // Check which terms are already in the dictionary
    const existing = terms.filter(t => t.term in before);
    const new_ = terms.filter(t => !(t.term in before));
    console.log(`Already in dict: ${existing.length}`);
    console.log(`New terms: ${new_.length}`);

    // Show sample new terms
    console.log('\nSample new terms:');
    for (const t of new_.slice(0, 10)) {
      console.log(`  [${t.family}] ${t.term} - ${t.meaning}`);
    }
    return;
  }

  // Merge into dictionary
  console.log('\nMerging into dictionary...');
  const result = await mergeEntriesIntoDictionary(terms, {
    dictionaryPath: join(PROJECT_ROOT, 'server', 'data', 'deepseekKeywordDictionary.json'),
  });

  console.log(`Merge result: ${result.entries?.length || 0} entries processed`);

  // Check after
  const after = await readKeywordDictionary();
  console.log(`Dictionary after: ${Object.keys(after).length} terms`);
  console.log(`Delta: ${Object.keys(after).length - Object.keys(before).length} new terms added`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
