import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DEFAULT_ANALYSIS, DEFAULT_PAYLOAD } from './compareDeepSeekAnalysisNormalization.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = [
  'ok',
  'provider',
  'model',
  'reasoningEffort',
  'axes',
  'sentenceAnalyses',
  'confidence',
  'fallback',
  'retriedCompactPrompt',
];

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareDeepSeekAnalyzeCommandObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsFixtureCommand({ payload, analysisPath }) {
  const { stdout } = await execFileAsync(
    'node',
    ['server/scripts/analyzeDeepSeekComments.js', '--fixture-analysis', analysisPath, '--text', payload.text || '', '--uid', payload.uid || ''],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonFixtureCommand({ payload, analysisPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.deepseek_analyze', '--fixture-analysis', analysisPath, '--text', payload.text || '', '--uid', payload.uid || ''],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareDeepSeekAnalyzeCommand({
  payload = { ...DEFAULT_PAYLOAD, uid: '42' },
  analysis = DEFAULT_ANALYSIS,
  runJsCommand = runJsFixtureCommand,
  runPythonCommand = runPythonFixtureCommand,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-command-compare-'));
  try {
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const js = await runJsCommand({ payload, analysis, analysisPath });
    const python = await runPythonCommand({ payload, analysis, analysisPath });
    const comparison = compareDeepSeekAnalyzeCommandObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { payload, analysisPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDeepSeekAnalyzeCommand();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
