import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { validateDeepSeekAnalysisPayloads } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_PAYLOAD = {
  comments: ['狗头保命[doge]', '建议查查资料再说'],
};

export const DEFAULT_ANALYSIS = {
  parsed: {
    sentenceAnalyses: [
      { quote: '狗头保命[doge]', risk: 'low' },
      { quote: '你真是傻逼', risk: 'high' },
    ],
    axes: [
      { axis: 'attack', score: 82, evidence: ['你真是傻逼'] },
      { axis: 'evidence', score: 60, evidence: ['查查资料'] },
    ],
  },
};

const RESULT_KEYS = ['ok', 'summary', 'unsupportedQuotes', 'unsupportedAxisEvidence'];

function summarizeValidation(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareValidationObjects(pythonValidation = {}, jsValidation = {}) {
  const mismatches = RESULT_KEYS
    .filter((key) => key in jsValidation && JSON.stringify(pythonValidation[key]) !== JSON.stringify(jsValidation[key]))
    .map((key) => ({
      key,
      python: pythonValidation[key],
      js: jsValidation[key],
    }));

  return {
    ok: mismatches.length === 0,
    mismatches,
    python: summarizeValidation(pythonValidation),
    js: summarizeValidation(jsValidation),
  };
}

async function runPythonValidation({ payload, analysis }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-validation-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(
        'python',
        ['-m', 'python_backend.cli.deepseek_analysis_validate', '--payload', payloadPath, '--analysis', analysisPath],
        {
          cwd: process.cwd(),
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
          maxBuffer: 10 * 1024 * 1024,
        },
      ));
    } catch (error) {
      stdout = error.stdout || '';
      if (!stdout) throw error;
    }
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareDeepSeekAnalysisValidation({
  payload = DEFAULT_PAYLOAD,
  analysis = DEFAULT_ANALYSIS,
  runPythonValidation: runPython = runPythonValidation,
} = {}) {
  const js = validateDeepSeekAnalysisPayloads(payload, analysis);
  const python = await runPython({ payload, analysis });
  const comparison = compareValidationObjects(python, js);

  return {
    ok: comparison.ok,
    fixture: { payload, analysis },
    js,
    python,
    mismatches: comparison.mismatches,
  };
}

async function main() {
  const result = await compareDeepSeekAnalysisValidation();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
