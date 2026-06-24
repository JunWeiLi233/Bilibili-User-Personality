import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['count', 'candidates', 'summary'];

const DEFAULT_DICTIONARY = {
  entries: [
    { term: '零证据', family: 'attack', meaning: 'needs evidence', evidenceCount: 0 },
    { term: '已有证据', family: 'evidence', meaning: 'has evidence', evidenceCount: 3 },
  ],
};

const DEFAULT_STATE = {
  termAttempts: {
    零证据: { attempts: 12 },
    已有证据: { attempts: 12 },
  },
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareExhaustedTermsPrunePlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function writeJson(path, payload) {
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
}

async function runJsPlan({ dictionaryPath, statePath }) {
  const { stdout } = await execFileAsync(
    'node',
    ['server/scripts/pruneExhaustedTerms.js', '--json', '--dictionary', dictionaryPath, '--state', statePath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER: '10',
        BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL: '',
        BILIBILI_HARVEST_PRUNE_APPLY: '',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonPlan({ dictionaryPath, statePath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.exhausted_terms_prune_plan', '--dictionary', dictionaryPath, '--state', statePath, '--attempt-threshold', '10'],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonPlanComparison({ dictionaryPath, statePath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.exhausted_terms_prune_plan',
      '--dictionary',
      dictionaryPath,
      '--state',
      statePath,
      '--attempt-threshold',
      '10',
      '--compare-js-report',
      jsReportPath,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareExhaustedTermsPrunePlan({
  dictionary = DEFAULT_DICTIONARY,
  state = DEFAULT_STATE,
  runJsPlan: runJs = runJsPlan,
  runPythonPlan: runPython = runPythonPlan,
  runCompare = runPythonPlanComparison,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'exhausted-prune-compare-'));
  try {
    const jsDictionaryPath = join(tempDir, 'dictionary.js.json');
    const pythonDictionaryPath = join(tempDir, 'dictionary.python.json');
    const jsStatePath = join(tempDir, 'state.js.json');
    const pythonStatePath = join(tempDir, 'state.python.json');
    await writeJson(jsDictionaryPath, dictionary);
    await writeJson(pythonDictionaryPath, dictionary);
    await writeJson(jsStatePath, state);
    await writeJson(pythonStatePath, state);
    const js = await runJs({ dictionaryPath: jsDictionaryPath, statePath: jsStatePath, dictionary, state });
    const python = await runPython({ dictionaryPath: pythonDictionaryPath, statePath: pythonStatePath, dictionary, state });
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeJson(jsReportPath, js);
    const comparison = await runCompare({
      dictionaryPath: pythonDictionaryPath,
      statePath: pythonStatePath,
      jsReportPath,
      dictionary,
      state,
      js,
      python,
      jsReport: js,
      pythonReport: python,
    });
    return {
      ok: comparison.ok,
      fixture: { jsDictionaryPath, pythonDictionaryPath, jsStatePath, pythonStatePath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareExhaustedTermsPrunePlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
