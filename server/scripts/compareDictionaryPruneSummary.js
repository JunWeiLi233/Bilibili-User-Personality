import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['entries', 'asciiTerms', 'summary'];

const DEFAULT_DICTIONARY = {
  entries: [
    { term: 'doge', family: 'attack', meaning: 'ascii emoji name noise' },
    { term: 'YYGQ', family: 'attack', meaning: 'allowed pinyin acronym' },
    { term: '阴阳怪气', family: 'attack', meaning: 'satirical tone' },
    { term: 'md5', family: 'evasion', meaning: 'random ascii hash fragment' },
    { term: 'BV1xx411c7mD', family: 'evidence', meaning: 'video id fragment' },
  ],
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareDictionaryPruneSummaryObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function writeDictionaryFixture(path, dictionary) {
  await writeFile(path, JSON.stringify(dictionary, null, 2), 'utf8');
}

async function runJsPruneSummary({ dictionaryPath }) {
  const { stdout } = await execFileAsync(
    'node',
    ['server/scripts/pruneKeywordDictionary.js', '--json', '--dictionary', dictionaryPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonPruneSummary({ dictionaryPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.dictionary_prune_summary', '--dictionary', dictionaryPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonPruneSummaryWrite({ dictionaryPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.dictionary_prune_summary', '--dictionary', dictionaryPath, '--write'],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function persistedDictionaryTerms(dictionaryPath) {
  const manifest = await readJson(dictionaryPath, {});
  if (manifest.storage !== 'split') {
    return (Array.isArray(manifest.entries) ? manifest.entries : [])
      .map((entry) => String(entry?.term || '').trim())
      .filter(Boolean)
      .sort();
  }
  const terms = [];
  const entryFiles = manifest.entryFiles && typeof manifest.entryFiles === 'object' ? manifest.entryFiles : {};
  for (const files of Object.values(entryFiles)) {
    for (const relativePath of Array.isArray(files) ? files : []) {
      const shard = await readJson(join(dictionaryPath, '..', relativePath), {});
      for (const entry of Array.isArray(shard.entries) ? shard.entries : []) {
        const term = String(entry?.term || '').trim();
        if (term) terms.push(term);
      }
    }
  }
  return [...new Set(terms)].sort();
}

export async function compareDictionaryPruneSummary({
  dictionary = DEFAULT_DICTIONARY,
  write = false,
  runJsSummary = runJsPruneSummary,
  runPythonSummary = runPythonPruneSummary,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'dictionary-prune-compare-'));
  try {
    const jsDictionaryPath = join(tempDir, 'dictionary.js.json');
    const pythonDictionaryPath = join(tempDir, 'dictionary.python.json');
    await writeDictionaryFixture(jsDictionaryPath, dictionary);
    await writeDictionaryFixture(pythonDictionaryPath, dictionary);
    const js = await runJsSummary({ dictionaryPath: jsDictionaryPath, dictionary });
    const python = await (write ? runPythonPruneSummaryWrite : runPythonSummary)({ dictionaryPath: pythonDictionaryPath, dictionary });
    const comparison = compareDictionaryPruneSummaryObjects(python, js);
    const persisted = write
      ? {
        jsTerms: await persistedDictionaryTerms(jsDictionaryPath),
        pythonTerms: await persistedDictionaryTerms(pythonDictionaryPath),
      }
      : undefined;
    const persistedMismatches = persisted && JSON.stringify(persisted.jsTerms) !== JSON.stringify(persisted.pythonTerms)
      ? [{ key: 'persistedTerms', python: persisted.pythonTerms, js: persisted.jsTerms }]
      : [];
    return {
      ok: comparison.ok && persistedMismatches.length === 0,
      fixture: { jsDictionaryPath, pythonDictionaryPath },
      js,
      python,
      persisted,
      mismatches: [...comparison.mismatches, ...persistedMismatches],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDictionaryPruneSummary();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
