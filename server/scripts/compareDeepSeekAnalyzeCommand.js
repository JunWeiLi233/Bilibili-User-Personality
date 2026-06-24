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

export function buildDeepSeekAnalyzeCommandArgs({ runtime = 'js', mode = 'fixture', analysisPath = '', payload = {} } = {}) {
  const args = runtime === 'python' ? ['-m', 'python_backend.cli.deepseek_analyze'] : ['server/scripts/analyzeDeepSeekComments.js'];
  if (mode === 'fixture') args.push('--fixture-analysis', analysisPath);
  if (mode === 'mock') args.push('--mock-chat-analysis', analysisPath);
  if (mode === 'live-gate') args.push('--live-validation-gate');
  if (mode === 'live-preflight') args.push('--live-preflight');
  if (payload.filePath) args.push('--file', payload.filePath);
  else if (payload.text) args.push('--text', payload.text);
  if (payload.uid) args.push('--uid', payload.uid);
  if (payload.name) args.push('--name', payload.name);
  if (payload.multiagent) args.push('--multiagent');
  return args;
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
    buildDeepSeekAnalyzeCommandArgs({ runtime: 'js', mode: 'fixture', analysisPath, payload }),
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
    buildDeepSeekAnalyzeCommandArgs({ runtime: 'python', mode: 'fixture', analysisPath, payload }),
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function runPythonCommandReportComparison({ pythonReportPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.deepseek_analyze_command_compare',
      '--python-report',
      pythonReportPath,
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

async function runJsMockRuntimeCommand({ payload, analysisPath }) {
  const args = buildDeepSeekAnalyzeCommandArgs({ runtime: 'js', mode: 'mock', analysisPath, payload });
  const { stdout } = await execFileAsync('node', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonMockRuntimeCommand({ payload, analysisPath }) {
  const args = buildDeepSeekAnalyzeCommandArgs({ runtime: 'python', mode: 'mock', analysisPath, payload });
  const { stdout } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonLiveGateCommand({ payload }) {
  const args = buildDeepSeekAnalyzeCommandArgs({ runtime: 'python', mode: 'live-gate', payload });
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

async function runPythonLivePreflightCommand({ payload }) {
  const args = buildDeepSeekAnalyzeCommandArgs({ runtime: 'python', mode: 'live-preflight', payload });
  const { stdout } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'configured-for-preflight',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runJsEnvPythonRuntimeBridgeCommand({ payload, analysisPath }) {
  const args = buildDeepSeekAnalyzeCommandArgs({ runtime: 'js', mode: 'mock', analysisPath, payload });
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
  runCompare = runPythonCommandReportComparison,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-command-compare-'));
  try {
    const analysisPath = join(tempDir, 'analysis.json');
    const pythonReportPath = join(tempDir, 'python-report.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const commandPayload = { ...payload };
    if (typeof payload.fileText === 'string') {
      const filePath = join(tempDir, 'input.txt');
      await writeFile(filePath, payload.fileText, 'utf8');
      commandPayload.filePath = filePath;
      delete commandPayload.text;
    }
    const js = await runJsCommand({ payload: commandPayload, analysis, analysisPath });
    const python = await runPythonCommand({ payload: commandPayload, analysis, analysisPath });
    await writeFile(pythonReportPath, JSON.stringify(python || {}, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({
      payload,
      commandPayload,
      analysis,
      analysisPath,
      pythonReportPath,
      jsReportPath,
      js,
      python,
      jsCommand: js,
      pythonCommand: python,
    });
    return {
      ok: comparison.ok,
      fixture: { payload, commandPayload, analysisPath, pythonReportPath, jsReportPath },
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

export async function compareDeepSeekAnalyzeLivePreflight({
  payload = { ...DEFAULT_PAYLOAD, uid: '42', multiagent: true },
  runPythonCommand = runPythonLivePreflightCommand,
} = {}) {
  const python = await runPythonCommand({ payload });
  const ok = Boolean(
    python.ok &&
      python.provider === 'deepseek' &&
      python.gate === 'live_api_preflight' &&
      python.willCallApi === false &&
      python.apiKey?.env === 'DEEPSEEK_API_KEY' &&
      python.request?.multiagent === true &&
      python.runtime?.mode === 'live_multiagent_preflight',
  );
  return {
    ok,
    python,
    mismatches: ok
      ? []
      : [
          {
            key: 'livePreflight',
            python,
            expected: {
              ok: true,
              provider: 'deepseek',
              gate: 'live_api_preflight',
              willCallApi: false,
              runtime: { mode: 'live_multiagent_preflight' },
            },
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
  compareLivePreflight = compareDeepSeekAnalyzeLivePreflight,
  compareLiveGate = compareDeepSeekAnalyzeLiveGate,
} = {}) {
  const fixtureCommand = await compareFixtureCommand();
  const commandMockRuntime = await compareCommandMockRuntime();
  const mockRuntime = await compareMockRuntime();
  const multiagentMockRuntime = await compareMockRuntime({ payload: { ...DEFAULT_PAYLOAD, multiagent: true } });
  const envPythonRuntimeBridge = await compareEnvPythonRuntimeBridge();
  const livePreflight = await compareLivePreflight();
  const liveValidationGate = await compareLiveGate();
  const mismatches = [
    ...prefixMismatches('fixtureCommand', fixtureCommand.mismatches || []),
    ...prefixMismatches('commandMockRuntime', commandMockRuntime.mismatches || []),
    ...prefixMismatches('mockRuntime', mockRuntime.mismatches || []),
    ...prefixMismatches('multiagentMockRuntime', multiagentMockRuntime.mismatches || []),
    ...prefixMismatches('envPythonRuntimeBridge', envPythonRuntimeBridge.mismatches || []),
    ...prefixMismatches('livePreflight', livePreflight.mismatches || []),
    ...prefixMismatches('liveValidationGate', liveValidationGate.mismatches || []),
  ];
  return {
    ok: Boolean(
      fixtureCommand.ok &&
        commandMockRuntime.ok &&
        mockRuntime.ok &&
        multiagentMockRuntime.ok &&
        envPythonRuntimeBridge.ok &&
        livePreflight.ok &&
        liveValidationGate.ok &&
        mismatches.length === 0,
    ),
    checks: { fixtureCommand, commandMockRuntime, mockRuntime, multiagentMockRuntime, envPythonRuntimeBridge, livePreflight, liveValidationGate },
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
