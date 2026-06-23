import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DEFAULT_ANALYSIS, DEFAULT_PAYLOAD } from './compareDeepSeekAnalysisNormalization.js';
import { compareDeepSeekAnalyzeMockRuntime } from './compareDeepSeekAnalyzeMockRuntime.js';

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
  'runtime',
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

async function runJsMockRuntimeCommand({ payload, analysisPath }) {
  const args = [
    'server/scripts/analyzeDeepSeekComments.js',
    '--mock-chat-analysis',
    analysisPath,
    '--text',
    payload.text || '',
    '--uid',
    payload.uid || '',
  ];
  if (payload.multiagent) args.push('--multiagent');
  const { stdout } = await execFileAsync('node', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonMockRuntimeCommand({ payload, analysisPath }) {
  const args = [
    '-m',
    'python_backend.cli.deepseek_analyze',
    '--mock-chat-analysis',
    analysisPath,
    '--text',
    payload.text || '',
    '--uid',
    payload.uid || '',
  ];
  if (payload.multiagent) args.push('--multiagent');
  const { stdout } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonLiveGateCommand({ payload }) {
  const args = [
    '-m',
    'python_backend.cli.deepseek_analyze',
    '--live-validation-gate',
    '--text',
    payload.text || '',
    '--uid',
    payload.uid || '',
  ];
  if (payload.multiagent) args.push('--multiagent');
  const { stdout } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: '',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runJsEnvPythonRuntimeBridgeCommand({ payload, analysisPath }) {
  const args = [
    'server/scripts/analyzeDeepSeekComments.js',
    '--mock-chat-analysis',
    analysisPath,
    '--text',
    payload.text || '',
    '--uid',
    payload.uid || '',
  ];
  if (payload.multiagent) args.push('--multiagent');
  const { stdout } = await execFileAsync('node', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BILIBILI_DEEPSEEK_ANALYZE_USE_PYTHON_RUNTIME: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
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

export async function compareDeepSeekAnalyzeCommandMockRuntime({
  payload = { ...DEFAULT_PAYLOAD, uid: '42' },
  analysis = DEFAULT_ANALYSIS,
  runJsCommand = runJsMockRuntimeCommand,
  runPythonCommand = runPythonMockRuntimeCommand,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-command-mock-runtime-'));
  try {
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(analysisPath, JSON.stringify(analysis.parsed || analysis, null, 2), 'utf8');
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

export async function compareDeepSeekAnalyzeEnvPythonRuntimeBridge({
  payload = { ...DEFAULT_PAYLOAD, uid: '42', multiagent: true },
  analysis = DEFAULT_ANALYSIS,
  runJsCommand = runJsEnvPythonRuntimeBridgeCommand,
  runPythonCommand = runPythonMockRuntimeCommand,
} = {}) {
  return compareDeepSeekAnalyzeCommandMockRuntime({
    payload,
    analysis,
    runJsCommand,
    runPythonCommand,
  });
}

export async function compareDeepSeekAnalyzeLiveGate({
  payload = { ...DEFAULT_PAYLOAD, uid: '42', multiagent: true },
  runPythonCommand = runPythonLiveGateCommand,
} = {}) {
  const python = await runPythonCommand({ payload });
  const ok = Boolean(
    python.ok &&
      python.provider === 'deepseek' &&
      python.gate === 'live_api_command' &&
      ['covered', 'skipped'].includes(python.status),
  );
  return {
    ok,
    python,
    mismatches: ok
      ? []
      : [
          {
            key: 'liveValidationGate',
            python,
            expected: { ok: true, provider: 'deepseek', gate: 'live_api_command', status: 'covered|skipped' },
          },
        ],
  };
}

function prefixMismatches(scope, mismatches = []) {
  return mismatches.map((mismatch) => ({
    ...mismatch,
    scope,
    key: `${scope}.${mismatch.key}`,
  }));
}

export async function compareDeepSeekAnalyzeCommandSuite({
  compareFixtureCommand = compareDeepSeekAnalyzeCommand,
  compareCommandMockRuntime = compareDeepSeekAnalyzeCommandMockRuntime,
  compareMockRuntime = compareDeepSeekAnalyzeMockRuntime,
  compareEnvPythonRuntimeBridge = compareDeepSeekAnalyzeEnvPythonRuntimeBridge,
  compareLiveGate = compareDeepSeekAnalyzeLiveGate,
} = {}) {
  const fixtureCommand = await compareFixtureCommand();
  const commandMockRuntime = await compareCommandMockRuntime();
  const mockRuntime = await compareMockRuntime();
  const multiagentMockRuntime = await compareMockRuntime({ payload: { ...DEFAULT_PAYLOAD, multiagent: true } });
  const envPythonRuntimeBridge = await compareEnvPythonRuntimeBridge();
  const liveValidationGate = await compareLiveGate();
  const mismatches = [
    ...prefixMismatches('fixtureCommand', fixtureCommand.mismatches || []),
    ...prefixMismatches('commandMockRuntime', commandMockRuntime.mismatches || []),
    ...prefixMismatches('mockRuntime', mockRuntime.mismatches || []),
    ...prefixMismatches('multiagentMockRuntime', multiagentMockRuntime.mismatches || []),
    ...prefixMismatches('envPythonRuntimeBridge', envPythonRuntimeBridge.mismatches || []),
    ...prefixMismatches('liveValidationGate', liveValidationGate.mismatches || []),
  ];
  return {
    ok: Boolean(
      fixtureCommand.ok &&
        commandMockRuntime.ok &&
        mockRuntime.ok &&
        multiagentMockRuntime.ok &&
        envPythonRuntimeBridge.ok &&
        liveValidationGate.ok &&
        mismatches.length === 0,
    ),
    checks: { fixtureCommand, commandMockRuntime, mockRuntime, multiagentMockRuntime, envPythonRuntimeBridge, liveValidationGate },
    mismatches,
  };
}

async function main() {
  const result = await compareDeepSeekAnalyzeCommandSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
