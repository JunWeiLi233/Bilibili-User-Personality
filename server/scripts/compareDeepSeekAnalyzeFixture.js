import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ANALYSIS,
  DEFAULT_PAYLOAD,
} from './compareDeepSeekAnalysisNormalization.js';

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG = { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' };

async function runJsFixtureCommand({ payload, analysis }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-analyze-fixture-'));
  try {
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'node',
      ['server/scripts/analyzeDeepSeekComments.js', '--fixture-analysis', analysisPath, '--text', payload.text || ''],
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

async function runPythonNormalization({ payload, analysis, config = DEFAULT_CONFIG }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-analyze-fixture-python-'));
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
        config.provider,
        '--model',
        config.model,
        '--reasoning-effort',
        config.reasoningEffort,
        '--raw',
        JSON.stringify(analysis),
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

async function runPythonFixtureComparison({ payloadPath, analysisPath, jsReportPath, config = DEFAULT_CONFIG, analysis }) {
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
      config.provider,
      '--model',
      config.model,
      '--reasoning-effort',
      config.reasoningEffort,
      '--raw',
      JSON.stringify(analysis),
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

export async function compareDeepSeekAnalyzeFixture({
  payload = DEFAULT_PAYLOAD,
  analysis = DEFAULT_ANALYSIS,
  runJsFixture = runJsFixtureCommand,
  runPythonNormalization: runPython = runPythonNormalization,
  runCompare = runPythonFixtureComparison,
} = {}) {
  const js = await runJsFixture({ payload, analysis });
  const python = await runPython({ payload, analysis, config: DEFAULT_CONFIG });
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-analyze-fixture-compare-'));
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
      config: DEFAULT_CONFIG,
      payloadPath,
      analysisPath,
      jsReportPath,
      js,
      python,
      jsFixture: js,
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
  const result = await compareDeepSeekAnalyzeFixture();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
