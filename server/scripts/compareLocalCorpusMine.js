import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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
  'entries',
];

const FIXTURE_DICTIONARY = {
  version: 1,
  entries: [
    {
      term: '考据呢',
      family: 'evidence',
      meaning: '要求给出来源',
      evidenceCount: 5,
      evidenceSamples: [],
      evidenceSources: [],
    },
    {
      term: '阴阳怪气',
      family: 'attack',
      meaning: '暗讽和讽刺',
      evidenceCount: 0,
      evidenceSamples: [],
      evidenceSources: [],
    },
  ],
};

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

async function runPythonLocalMine({ dictionaryPath, corpusPath, actionPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
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
    ],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

export async function compareLocalCorpusMine({
  runPythonMine = runPythonLocalMine,
  dictionary = FIXTURE_DICTIONARY,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'local-mine-compare-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    const corpusPath = join(tempDir, 'comments.json');
    const actionPath = join(tempDir, 'actions.json');
    await writeFile(dictionaryPath, JSON.stringify(dictionary, null, 2), 'utf8');
    await writeFile(
      corpusPath,
      JSON.stringify(
        {
          comments: [
            { message: '你这阴阳怪气的语气是吧', source: 'Bilibili local corpus' },
            { message: '考据呢？没有来源别乱说', source: 'Tieba local corpus' },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(actionPath, JSON.stringify([{ term: '考据呢' }], null, 2), 'utf8');

    const argv = [
      `--corpus=${corpusPath}`,
      `--actions=${actionPath}`,
      '--target-evidence=3',
      '--max-samples-per-term=2',
    ];
    const js = await runLocalCorpusEvidenceMining({
      argv,
      env: {},
      readDictionary: async () => dictionary,
      mergeDictionary: async () => dictionary,
      log: () => {},
    });
    const python = await runPythonMine({ dictionaryPath, corpusPath, actionPath });
    const comparison = compareLocalCorpusMineObjects(python, js);
    return { ok: comparison.ok, fixture: { corpusPath, actionPath }, js, python, mismatches: comparison.mismatches };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareLocalCorpusMine();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
