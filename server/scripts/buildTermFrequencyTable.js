/**
 * Builds a term frequency table from the random sampling eval corpus.
 *
 * Scans all scored user files in .claude/random_sampling_eval/scored/,
 * aggregates per-term userCount (number of users containing the term)
 * and totalCount (total occurrences), and outputs:
 *
 *   server/data/termFrequency.json
 *
 * Usage:
 *   node server/scripts/buildTermFrequencyTable.js [--corpus=<dir>] [--output=<path>]
 *
 *   --corpus   Dir containing scored UID JSONs (default: .claude/random_sampling_eval/scored/)
 *   --output   Output path (default: server/data/termFrequency.json)
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { corpus: '', output: '' };
  for (const a of argv) {
    if (a.startsWith('--corpus=')) args.corpus = a.split('=')[1];
    else if (a.startsWith('--output=')) args.output = a.split('=')[1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusDir = args.corpus || join(PROJECT, '.claude', 'random_sampling_eval', 'scored');
  const outputPath = args.output || join(PROJECT, 'server', 'data', 'termFrequency.json');

  // Read all scored JSON files
  const files = (await readdir(corpusDir)).filter(f => f.endsWith('.json'));

  /** @type {Map<string, {totalCount: number, userCount: number, family: string, axis: string, polarity: string}>} */
  const termMap = new Map();

  for (const fn of files) {
    let data;
    try {
      data = JSON.parse(await readFile(join(corpusDir, fn), 'utf8'));
    } catch {
      console.warn(`  Skipping unreadable: ${fn}`);
      continue;
    }
    const marks = data.vocabularyMarks || [];
    if (marks.length === 0) continue;

    const seen = new Set();
    for (const mark of marks) {
      const term = mark.term;
      if (!term) continue;

      let entry = termMap.get(term);
      if (!entry) {
        entry = {
          totalCount: 0,
          userCount: 0,
          family: mark.family || '',
          axis: mark.axis || '',
          polarity: mark.polarity || '',
        };
        termMap.set(term, entry);
      }
      entry.totalCount += mark.count || 0;
      if (!seen.has(term)) {
        entry.userCount += 1;
        seen.add(term);
      }
    }
  }

  const N = files.length;
  const table = {};
  for (const [term, entry] of termMap) {
    table[term] = {
      ...entry,
      userFraction: N > 0 ? entry.userCount / N : 0,
    };
  }

  // Sort by userCount descending for readability
  const sorted = {};
  for (const [term, entry] of Object.entries(table).sort((a, b) => b[1].userCount - a[1].userCount)) {
    sorted[term] = entry;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(sorted, null, 2), 'utf8');

  const terms = Object.keys(table);
  const highFreq = terms.filter(t => table[t].userFraction > 0.30).length;
  const midFreq = terms.filter(t => table[t].userFraction > 0.10 && table[t].userFraction <= 0.30).length;
  const lowFreq = terms.filter(t => table[t].userFraction <= 0.10).length;

  console.log(`Term frequency table built from ${N} users.`);
  console.log(`  Total unique terms: ${terms.length}`);
  console.log(`  High freq (>30%):   ${highFreq}`);
  console.log(`  Mid freq (10-30%):  ${midFreq}`);
  console.log(`  Low freq (≤10%):    ${lowFreq}`);
  console.log(`  Output: ${outputPath}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
