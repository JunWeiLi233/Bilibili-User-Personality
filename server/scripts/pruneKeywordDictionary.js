import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DICTIONARY_PATH, mergeEntriesIntoDictionary } from '../services/deepseekKeywordTrainer.js';

function parseArgs(argv = process.argv.slice(2)) {
  const options = { dictionaryPath: DEFAULT_DICTIONARY_PATH, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--dictionary') {
      options.dictionaryPath = argv[index + 1] || options.dictionaryPath;
      index += 1;
    } else if (arg.startsWith('--dictionary=')) {
      options.dictionaryPath = arg.slice('--dictionary='.length) || options.dictionaryPath;
    }
  }
  return options;
}

function countSummary(dictionary) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const asciiEntries = entries.filter((entry) => /^[A-Za-z0-9]+$/.test(String(entry.term || '')));
  return {
    totalEntries: entries.length,
    asciiEntries: asciiEntries.length,
  };
}

function buildSummary(before, after) {
  const beforeSummary = countSummary(before);
  const afterSummary = countSummary(after);
  return {
    ok: true,
    dictionaryPath: '',
    entries: {
      before: beforeSummary.totalEntries,
      after: afterSummary.totalEntries,
      removed: Math.max(0, beforeSummary.totalEntries - afterSummary.totalEntries),
    },
    asciiTerms: {
      before: beforeSummary.asciiEntries,
      after: afterSummary.asciiEntries,
      removed: Math.max(0, beforeSummary.asciiEntries - afterSummary.asciiEntries),
    },
    summary: {
      totalEntries: beforeSummary.totalEntries,
      asciiEntries: beforeSummary.asciiEntries,
      afterEntries: afterSummary.totalEntries,
      afterAsciiEntries: afterSummary.asciiEntries,
    },
  };
}

export async function runPruneKeywordDictionary(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const before = await readFile(options.dictionaryPath, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => ({ entries: [] }));

  const pruned = await mergeEntriesIntoDictionary([], { dictionaryPath: options.dictionaryPath });
  const summary = { ...buildSummary(before, pruned), dictionaryPath: options.dictionaryPath };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log(`Dictionary path: ${options.dictionaryPath}`);
  console.log(`Entries: ${summary.entries.before} -> ${summary.entries.after}`);
  console.log(`ASCII terms: ${summary.asciiTerms.before} -> ${summary.asciiTerms.after}`);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPruneKeywordDictionary().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
