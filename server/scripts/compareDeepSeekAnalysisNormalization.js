import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { normalizeDeepSeekAnalysisResult } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_PAYLOAD = {
  text: '狗头保命[doge]\n建议查查资料再说',
};

export const DEFAULT_ANALYSIS = {
  parsed: {
    axes: [
      { axis: 'attack', score: 120, evidence: ['狗头保命[doge]'], reasoning: 'meme tone' },
      { axis: 'evidence', score: -5, evidence: [], reasoning: 'missing' },
    ],
    sentenceAnalyses: [
      {
        quote: '狗头保命',
        speechAct: '玩梗',
        target: '自我保护',
        stance: '反讽',
        contextRole: '语气标记',
        risk: 'low',
        axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 2, reasoning: 'too strong' }],
        reasoning: 'emoji matters',
      },
    ],
    overall: { riskBand: '低风险讨论型', summary: 'emoji softens tone' },
    confidence: 2,
  },
};

const RESULT_KEYS = [
  'ok',
  'provider',
  'model',
  'reasoningEffort',
  'retriedCompactPrompt',
  'axes',
  'sentenceAnalyses',
  'overall',
  'confidence',
  'raw',
  'multiagent',
];

function summarizeNormalization(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareNormalizationObjects(pythonNormalization = {}, jsNormalization = {}) {
  const mismatches = RESULT_KEYS
    .filter((key) => key in jsNormalization && JSON.stringify(pythonNormalization[key]) !== JSON.stringify(jsNormalization[key]))
    .map((key) => ({
      key,
      python: pythonNormalization[key],
      js: jsNormalization[key],
    }));

  return {
    ok: mismatches.length === 0,
    mismatches,
    python: summarizeNormalization(pythonNormalization),
    js: summarizeNormalization(jsNormalization),
  };
}

async function runPythonNormalization({ payload, analysis, config, raw }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-normalization-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      [
        '-m',
        'python_backend.cli.deepseek_analysis_normalize',
        '--payload',
        payloadPath,
        '--analysis',
        analysisPath,
        '--provider',
        config.provider || 'deepseek',
        '--model',
        config.model || '',
        '--reasoning-effort',
        config.reasoningEffort || 'medium',
        '--raw',
        raw || '',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runPythonNormalizationComparison({ payloadPath, analysisPath, jsReportPath, config, raw }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.deepseek_analysis_normalize',
      '--payload',
      payloadPath,
      '--analysis',
      analysisPath,
      '--provider',
      config.provider || 'deepseek',
      '--model',
      config.model || '',
      '--reasoning-effort',
      config.reasoningEffort || 'medium',
      '--raw',
      raw || '',
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

export async function compareDeepSeekAnalysisNormalization({
  payload = DEFAULT_PAYLOAD,
  analysis = DEFAULT_ANALYSIS,
  config = { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
  raw = '{}',
  runPythonNormalization: runPython = runPythonNormalization,
  normalizeJs = normalizeDeepSeekAnalysisResult,
  runCompare = runPythonNormalizationComparison,
} = {}) {
  const parsed = analysis?.parsed && typeof analysis.parsed === 'object' ? analysis.parsed : analysis;
  const js = normalizeJs({ parsed, payload, config, raw, retriedCompactPrompt: false });
  const python = await runPython({ payload, analysis, config, raw });
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-normalization-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const analysisPath = join(tempDir, 'analysis.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({
      payload,
      analysis,
      config,
      raw,
      payloadPath,
      analysisPath,
      jsReportPath,
      js,
      python,
      jsNormalization: js,
      pythonNormalization: python,
    });

    return {
      ok: comparison.ok,
      fixture: { payload, analysis, payloadPath, analysisPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDeepSeekAnalysisNormalization();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
