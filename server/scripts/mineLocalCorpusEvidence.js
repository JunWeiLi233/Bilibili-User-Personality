import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readKeywordDictionary, mergeEntriesIntoDictionary, normalizeKeywordEntries } from '../services/deepseekKeywordTrainer.js';
import { findLocalCorpusEvidenceEntries, flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';
import { readJsonCorpus } from '../services/splitCorpusStorage.js';
import { DEFAULT_COVERAGE_ACTION_FILE_PATH } from '../utils/paths.js';

const DEFAULT_CORPUS_PATHS = [
  'server/data/uid-discovery-comments.json',
  'server/data/bilibiliDirectProbeCorpus.json',
  'server/data/tiebaKeywordCorpus.json',
  'server/data/huggingFaceKeywordCorpus.json',
];

export function parseCorpusPaths(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    corpusPaths: parseCorpusPaths(env.LOCAL_BILIBILI_CORPUS_PATH).length
      ? parseCorpusPaths(env.LOCAL_BILIBILI_CORPUS_PATH)
      : DEFAULT_CORPUS_PATHS,
    targetEvidence: Number(env.BILIBILI_COVERAGE_TARGET_EVIDENCE || 3),
    maxSamplesPerTerm: Number(env.LOCAL_CORPUS_MAX_SAMPLES_PER_TERM || 3),
    actionFile: env.LOCAL_CORPUS_ACTION_FILE || DEFAULT_COVERAGE_ACTION_FILE_PATH,
    requireCommentBackedEvidence: env.LOCAL_CORPUS_REQUIRE_COMMENT_BACKED !== '0',
    write: env.LOCAL_CORPUS_WRITE === '1',
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

export function targetTermsFromActions(actions = []) {
  return [...new Set(
    (Array.isArray(actions) ? actions : [])
      .map((action) => String(action?.term || '').trim())
      .filter(Boolean),
  )];
}

export async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  if (/\.txt$/i.test(path)) return raw.split(/\r?\n/);
  const parsed = JSON.parse(raw);
  if (parsed?.storage !== 'split' || !Array.isArray(parsed.commentFiles)) return parsed;
  return readJsonCorpus(path);
}

export async function runLocalCorpusEvidenceMining({
  argv = process.argv.slice(2),
  env = process.env,
  readDictionary = readKeywordDictionary,
  mergeDictionary = mergeEntriesIntoDictionary,
  normalizeEntries = normalizeKeywordEntries,
  readCorpus = readJson,
  readActions = readJsonIfExists,
  flattenCorpus = flattenBilibiliCommentCorpus,
  findEntries = findLocalCorpusEvidenceEntries,
  log = console.log,
} = {}) {
  const options = parseArgs(argv, env);
  const dictionary = await readDictionary();
  const corpora = await Promise.all(options.corpusPaths.map((path) => readCorpus(path)));
  const targetTerms = targetTermsFromActions(await readActions(options.actionFile, []));
  const comments = corpora.flatMap((corpus) => flattenCorpus(corpus));
  const rawEntries = findEntries(dictionary, comments, {
    targetEvidence: options.targetEvidence,
    maxSamplesPerTerm: options.maxSamplesPerTerm,
    targetTerms,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence,
  });
  const entries = normalizeEntries(rawEntries).filter(
    (entry) => (entry.evidenceSources || []).length > 0 || (entry.evidenceSamples || []).length > 0,
  );
  const filteredEntryCount = rawEntries.length - entries.length;

  log('Local Bilibili corpus evidence mining');
  log(`Corpus files: ${options.corpusPaths.join(', ')}`);
  log(`Corpus comments: ${comments.length}`);
  log(`Strict audit target terms: ${targetTerms.length}`);
  log(`Require comment-backed evidence: ${options.requireCommentBackedEvidence}`);
  log(`Weak-term evidence entries found: ${entries.length}`);
  if (filteredEntryCount > 0) log(`Filtered merge-rejected evidence entries: ${filteredEntryCount}`);
  for (const entry of entries.slice(0, 20)) {
    log(`- [${entry.family}] ${entry.term}: ${entry.evidenceSources.length} sample(s)`);
  }

  const result = {
    ok: true,
    corpusFiles: options.corpusPaths,
    corpusComments: comments.length,
    targetTerms,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence,
    targetEvidence: options.targetEvidence,
    maxSamplesPerTerm: options.maxSamplesPerTerm,
    write: options.write,
    entryCount: entries.length,
    rawEntryCount: rawEntries.length,
    filteredEntryCount,
    entries,
  };

  if (!options.write) {
    log('Dry run only. Pass --write to merge evidence into the dictionary.');
    return result;
  }

  const beforeCount = dictionary.entries?.length || 0;
  if (entries.length === 0) {
    log(`Dictionary entries before: ${beforeCount}`);
    log(`Dictionary entries after: ${beforeCount}`);
    log('No mergeable evidence found; dictionary write skipped.');
    return { ...result, dictionaryBefore: beforeCount, dictionaryAfter: beforeCount };
  }

  const next = await mergeDictionary(entries);
  log(`Dictionary entries before: ${beforeCount}`);
  log(`Dictionary entries after: ${next.entries?.length || 0}`);
  return { ...result, dictionaryBefore: beforeCount, dictionaryAfter: next.entries?.length || 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLocalCorpusEvidenceMining().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
