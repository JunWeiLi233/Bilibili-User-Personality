/**
 * Extract and merge DeepSeek-generated terms from output files into the dictionary.
 * Usage: node .claude/merge_generated_terms.js
 *   DRY_RUN=1 node .claude/merge_generated_terms.js  # just count, don't write
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const OUTPUT_FILES = ['.deepseek/output.md', '.deepseek/output2.md'];
const DRY_RUN = process.env.DRY_RUN === '1';
const MERGE_PATH = join(PROJECT_ROOT, 'server', 'data', 'generatedTermsBatch1.json');
const ALL_TERMS_PATH = join(PROJECT_ROOT, 'server', 'data', 'allGeneratedTerms.json');

function extractJsonArray(text) {
  // Remove markdown code fences
  let cleaned = text.replace(/```json[^\n]*\n/g, '').replace(/```\s*/g, '').trim();

  // Find the JSON array
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) {
    console.warn('Could not find JSON array in text');
    return [];
  }

  cleaned = cleaned.slice(start, end + 1);

  // Try to fix truncation by completing the last partial object
  // Find last complete object
  const lastComplete = cleaned.lastIndexOf('},');
  if (lastComplete !== -1) {
    cleaned = cleaned.slice(0, lastComplete + 1) + ']';
  } else {
    // Try closing with ]
    if (!cleaned.endsWith(']')) {
      cleaned += ']';
    }
  }

  try {
    const arr = JSON.parse(cleaned);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('JSON parse error:', e.message);
    // Try one more fix - find all complete objects
    const objects = [];
    const re = /\{[^}]+\}/g;
    let match;
    while ((match = re.exec(cleaned)) !== null) {
      try {
        objects.push(JSON.parse(match[0]));
      } catch {}
    }
    return objects;
  }
}

async function main() {
  console.log('Extracting generated terms...\n');

  const allTerms = [];
  const seen = new Set();
  const byFamily = {};
  let skipped = 0;

  for (const file of OUTPUT_FILES) {
    const path = join(PROJECT_ROOT, file);
    const text = await readFile(path, 'utf8');
    const terms = extractJsonArray(text);
    console.log(`${file}: ${terms.length} terms extracted`);

    for (const term of terms) {
      if (!term.term || !term.family) continue;

      const key = term.term;
      if (seen.has(key)) {
        skipped++;
        continue;
      }

      seen.add(key);

      // Normalize
      const entry = {
        term: String(term.term).trim(),
        family: String(term.family).trim(),
        meaning: String(term.meaning || '').trim(),
        risk: String(term.risk || 'medium').trim(),
        confidence: Number.isFinite(Number(term.confidence))
          ? Math.max(0.5, Math.min(0.95, Number(term.confidence)))
          : 0.75,
        evidenceCount: 0,
        evidenceSamples: [],
        evidenceSources: [],
      };

      // Validate
      if (entry.term.length < 2 || entry.term.length > 12) { skipped++; continue; }
      if (!['attack','absolutes','evidence','evasion','cooperation','correction'].includes(entry.family)) { skipped++; continue; }
      if (!entry.meaning || entry.meaning.length < 5) { skipped++; continue; }

      byFamily[entry.family] = (byFamily[entry.family] || 0) + 1;
      allTerms.push(entry);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Total unique terms: ${allTerms.length}`);
  console.log(`Duplicates skipped: ${skipped}`);
  console.log(`By family:`, byFamily);

  const report = {
    generatedAt: new Date().toISOString(),
    totalTerms: allTerms.length,
    byFamily,
    terms: allTerms,
  };

  await mkdir(dirname(ALL_TERMS_PATH), { recursive: true });
  await writeFile(ALL_TERMS_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nAll terms saved to: ${ALL_TERMS_PATH}`);

  if (DRY_RUN) {
    console.log('\nDry run. Set DRY_RUN=0 to merge into dictionary.');
    console.log('To merge:');
    console.log('  node .claude/merge_generated_terms.js');
    console.log('  DRY_RUN=0 WRITE=1 node .claude/generate_terms_deepseek.js  # for dict merge');
  }

  // Also write a simplified version (just terms array) for the dictionary expander
  const simple = allTerms.map(({ term, family, meaning, risk, confidence }) => ({
    term, family, meaning, risk, confidence,
  }));
  await writeFile(MERGE_PATH, JSON.stringify(simple, null, 2), 'utf8');
  console.log(`Simple terms saved to: ${MERGE_PATH}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
