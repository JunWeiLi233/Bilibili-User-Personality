import { readFile } from 'node:fs/promises';

import { readKeywordDictionary, mergeEntriesIntoDictionary, normalizeKeywordEntries } from '../services/deepseekKeywordTrainer.js';
import { findLocalCorpusEvidenceEntries, flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';
import { DEFAULT_COVERAGE_ACTION_FILE_PATH } from '../utils/paths.js';

const DEFAULT_CORPUS_PATHS = [
  'server/data/uid-discovery-comments.json',
  'server/data/bilibiliDirectProbeCorpus.json',
  'server/data/tiebaKeywordCorpus.json',
];

function parseCorpusPaths(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    corpusPaths: parseCorpusPaths(process.env.LOCAL_BILIBILI_CORPUS_PATH).length
      ? parseCorpusPaths(process.env.LOCAL_BILIBILI_CORPUS_PATH)
      : DEFAULT_CORPUS_PATHS,
    targetEvidence: Number(process.env.BILIBILI_COVERAGE_TARGET_EVIDENCE || 3),
    maxSamplesPerTerm: Number(process.env.LOCAL_CORPUS_MAX_SAMPLES_PER_TERM || 3),
    actionFile: process.env.LOCAL_CORPUS_ACTION_FILE || DEFAULT_COVERAGE_ACTION_FILE_PATH,
    requireCommentBackedEvidence: process.env.LOCAL_CORPUS_REQUIRE_COMMENT_BACKED !== '0',
    write: process.env.LOCAL_CORPUS_WRITE === '1',
  };
  for (const arg of argv) {
    if (arg.startsWith('--corpus=')) options.corpusPaths = parseCorpusPaths(arg.slice('--corpus='.length));
    else if (arg.startsWith('--actions=')) options.actionFile = arg.slice('--actions='.length).trim();
    else if (arg.startsWith('--target-evidence=')) options.targetEvidence = Number(arg.slice('--target-evidence='.length));
    else if (arg.startsWith('--max-samples-per-term=')) options.maxSamplesPerTerm = Number(arg.slice('--max-samples-per-term='.length));
    else if (arg === '--no-comment-backed') options.requireCommentBackedEvidence = false;
    else if (arg === '--write') options.write = true;
  }
  options.targetEvidence = Math.max(1, Math.min(Number(options.targetEvidence) || 3, 20));
  options.maxSamplesPerTerm = Math.max(1, Math.min(Number(options.maxSamplesPerTerm) || 3, 20));
  return options;
}

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function targetTermsFromActions(actions = []) {
  return [...new Set(
    (Array.isArray(actions) ? actions : [])
      .map((action) => String(action?.term || '').trim())
      .filter(Boolean),
  )];
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  if (/\.txt$/i.test(path)) return raw.split(/\r?\n/);
  return JSON.parse(raw);
}

const options = parseArgs();
const dictionary = await readKeywordDictionary();
const corpora = await Promise.all(options.corpusPaths.map((path) => readJson(path)));
const targetTerms = targetTermsFromActions(await readJsonIfExists(options.actionFile, []));
const comments = corpora.flatMap((corpus) => flattenBilibiliCommentCorpus(corpus));
const rawEntries = findLocalCorpusEvidenceEntries(dictionary, comments, {
  targetEvidence: options.targetEvidence,
  maxSamplesPerTerm: options.maxSamplesPerTerm,
  targetTerms,
  requireCommentBackedEvidence: options.requireCommentBackedEvidence,
});
const entries = normalizeKeywordEntries(rawEntries).filter(
  (entry) => (entry.evidenceSources || []).length > 0 || (entry.evidenceSamples || []).length > 0,
);
const filteredEntryCount = rawEntries.length - entries.length;

console.log('Local Bilibili corpus evidence mining');
console.log(`Corpus files: ${options.corpusPaths.join(', ')}`);
console.log(`Corpus comments: ${comments.length}`);
console.log(`Strict audit target terms: ${targetTerms.length}`);
console.log(`Require comment-backed evidence: ${options.requireCommentBackedEvidence}`);
console.log(`Weak-term evidence entries found: ${entries.length}`);
if (filteredEntryCount > 0) console.log(`Filtered merge-rejected evidence entries: ${filteredEntryCount}`);
for (const entry of entries.slice(0, 20)) {
  console.log(`- [${entry.family}] ${entry.term}: ${entry.evidenceSources.length} sample(s)`);
}

if (!options.write) {
  console.log('Dry run only. Pass --write to merge evidence into the dictionary.');
  process.exit(0);
}

const beforeCount = dictionary.entries?.length || 0;
if (entries.length === 0) {
  console.log(`Dictionary entries before: ${beforeCount}`);
  console.log(`Dictionary entries after: ${beforeCount}`);
  console.log('No mergeable evidence found; dictionary write skipped.');
  process.exit(0);
}

const next = await mergeEntriesIntoDictionary(entries);
console.log(`Dictionary entries before: ${beforeCount}`);
console.log(`Dictionary entries after: ${next.entries?.length || 0}`);
