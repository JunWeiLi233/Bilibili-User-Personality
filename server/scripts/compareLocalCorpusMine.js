import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { mergeEntriesIntoDictionary } from '../services/deepseekKeywordTrainer.js';
import { runLocalCorpusEvidenceMining } from './mineLocalCorpusEvidence.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = [
  'corpusComments',
  'targetTerms',
  'requireCommentBackedEvidence',
  'targetEvidence',
  'maxSamplesPerTerm',
  'write',
  'entryCount',
  'filteredEntryCount',
  'dictionaryBefore',
  'dictionaryAfter',
  'entries',
];

const EVIDENCE_TERM = '\u8003\u636e\u5462';
const ATTACK_TERM = '\u9634\u9633\u602a\u6c14';
const EVIDENCE_SAMPLE = '\u8003\u636e\u5462\uff1f\u6ca1\u6709\u6765\u6e90\u522b\u4e71\u8bf4';
const ATTACK_SAMPLE = '\u4f60\u8fd9\u9634\u9633\u602a\u6c14\u7684\u8bed\u6c14\u662f\u5427';

const FIXTURE_DICTIONARY = {
  version: 1,
  entries: [
    {
      term: EVIDENCE_TERM,
      family: 'evidence',
      meaning: '\u8981\u6c42\u7ed9\u51fa\u6765\u6e90',
      evidenceCount: 5,
      evidenceSamples: [],
      evidenceSources: [],
    },
    {
      term: ATTACK_TERM,
      family: 'attack',
      meaning: '\u6697\u8bbd\u548c\u8bbd\u523a',
      evidenceCount: 0,
      evidenceSamples: [],
      evidenceSources: [],
    },
  ],
};

const FIXTURE_CORPUS = {
  comments: [
    { message: ATTACK_SAMPLE, source: 'Bilibili local corpus' },
    { message: EVIDENCE_SAMPLE, source: 'Tieba local corpus' },
  ],
};

const FIXTURE_ACTIONS = [{ term: EVIDENCE_TERM }];

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function summarizeLocalCorpusMineResult(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareLocalCorpusMineObjects(pythonResult = {}, jsResult = {}) {
  const python = summarizeLocalCorpusMineResult(pythonResult);
  const js = summarizeLocalCorpusMineResult(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runPythonLocalMine({ dictionaryPath, corpusPath, actionPath, write = false }) {
  const args = [
    '-m',
    'python_backend.cli.local_corpus_mine',
    '--dictionary',
    dictionaryPath,
    '--corpus',
    corpusPath,
    '--actions',
    actionPath,
    '--target-evidence',
    '3',
    '--max-samples-per-term',
    '2',
  ];
  if (write) args.push('--write');
  const { stdout } = await execFileAsync('python', args, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function compareLocalCorpusMine({
  runPythonMine = runPythonLocalMine,
  dictionary = FIXTURE_DICTIONARY,
  corpus = FIXTURE_CORPUS,
  actions = FIXTURE_ACTIONS,
  write = false,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'local-mine-compare-'));
  try {
    const jsDictionaryPath = join(tempDir, 'dictionary.js.json');
    const pythonDictionaryPath = join(tempDir, 'dictionary.python.json');
    const corpusPath = join(tempDir, 'comments.json');
    const actionPath = join(tempDir, 'actions.json');
    await writeFile(jsDictionaryPath, JSON.stringify(dictionary, null, 2), 'utf8');
    await writeFile(pythonDictionaryPath, JSON.stringify(dictionary, null, 2), 'utf8');
    await writeFile(corpusPath, JSON.stringify(corpus, null, 2), 'utf8');
    await writeFile(actionPath, JSON.stringify(actions, null, 2), 'utf8');

    const argv = [
      `--corpus=${corpusPath}`,
      `--actions=${actionPath}`,
      '--target-evidence=3',
      '--max-samples-per-term=2',
    ];
    if (write) argv.push('--write');
    const js = await runLocalCorpusEvidenceMining({
      argv,
      env: {},
      readDictionary: async () => readJson(jsDictionaryPath),
      mergeDictionary: async (entries) =>
        mergeEntriesIntoDictionary(entries, {
          dictionaryPath: jsDictionaryPath,
          dictionaryLockPath: `${jsDictionaryPath}.lock`,
        }),
      log: () => {},
    });
    const python = await runPythonMine({
      dictionaryPath: pythonDictionaryPath,
      corpusPath,
      actionPath,
      write,
    });
    const comparison = compareLocalCorpusMineObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { corpusPath, actionPath, write },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareLocalCorpusMineSuite() {
  const dryRun = await compareLocalCorpusMine();
  const writeRun = await compareLocalCorpusMine({ write: true });
  return {
    ok: dryRun.ok && writeRun.ok,
    dryRun,
    writeRun,
    mismatches: [
      ...dryRun.mismatches.map((mismatch) => ({ ...mismatch, mode: 'dryRun' })),
      ...writeRun.mismatches.map((mismatch) => ({ ...mismatch, mode: 'writeRun' })),
    ],
  };
}

async function main() {
  const result = process.argv.includes('--write') ? await compareLocalCorpusMine({ write: true }) : await compareLocalCorpusMineSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
