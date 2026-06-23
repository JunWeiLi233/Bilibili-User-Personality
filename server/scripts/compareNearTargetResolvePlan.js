import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['candidateCount', 'candidateTerms', 'plannedCount', 'videosPlanned', 'plans', 'skipped', 'summary'];

const DEFAULT_DICTIONARY = {
  entries: [
    {
      term: '差一条',
      family: 'attack',
      meaning: '“差一条”用于嘲讽证据或条件刚好缺失的中文网络表达',
      evidenceCount: 2,
      evidenceSamples: ['差一条就别装满证据', '差一条还嘴硬'],
      evidenceSources: [
        { source: 'Bilibili source https://www.bilibili.com/video/BV1NearAAA1/', sample: '差一条就别装满证据' },
        { source: 'Bilibili source https://www.bilibili.com/video/BV1NearAAA1/', sample: '差一条还嘴硬' },
      ],
    },
  ],
};

const DEFAULT_STATE = {};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareNearTargetResolvePlanObjects(pythonResult = {}, jsResult = {}) {
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
    [
      'server/scripts/resolveNearTargetTerms.js',
      '--json',
      '--dictionary',
      dictionaryPath,
      '--state',
      statePath,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, RESOLVE_OVERRIDE_TERMS: '差一条', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonPlan({ dictionaryPath, statePath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.near_target_resolve_plan',
      '--dictionary',
      dictionaryPath,
      '--state',
      statePath,
      '--override-terms',
      '差一条',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareNearTargetResolvePlan({
  dictionary = DEFAULT_DICTIONARY,
  state = DEFAULT_STATE,
  runJsPlan: runJs = runJsPlan,
  runPythonPlan: runPython = runPythonPlan,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'near-target-compare-'));
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
    const comparison = compareNearTargetResolvePlanObjects(python, js);
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
  const result = await compareNearTargetResolvePlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
