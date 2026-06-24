import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { analyzeCommentsWithDeepSeek } from '../services/deepseekKeywordTrainer.js';
import {
  DEFAULT_ANALYSIS,
  DEFAULT_PAYLOAD,
} from './compareDeepSeekAnalysisNormalization.js';

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG = { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' };
const DEFAULT_RAW = JSON.stringify(DEFAULT_ANALYSIS.parsed);

async function runJsMockRuntime({ payload = DEFAULT_PAYLOAD, raw = DEFAULT_RAW } = {}) {
  const requests = [];
  const result = await analyzeCommentsWithDeepSeek(payload, {
    env: {
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
      DEEPSEEK_MODEL: DEFAULT_CONFIG.model,
      DEEPSEEK_REASONING_EFFORT: DEFAULT_CONFIG.reasoningEffort,
    },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: DEFAULT_CONFIG.model }] }),
        };
      }
      if (String(url).endsWith('/chat/completions')) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: raw } }] }),
        };
      }
      throw new Error(`Unexpected mocked DeepSeek URL: ${url}`);
    },
  });
  return { ...result, requests };
}

async function runPythonCommandRuntime({ payload, analysis }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-mock-runtime-python-'));
  try {
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      [
        '-m',
        'python_backend.cli.deepseek_analyze',
        '--mock-chat-analysis',
        analysisPath,
        '--text',
        payload.text || '',
        '--uid',
        payload.uid || '',
        ...(payload.multiagent ? ['--multiagent'] : []),
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

async function runPythonRequestPlan({ payload }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-mock-runtime-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      ['-m', 'python_backend.cli.deepseek_analysis_plan', '--payload', payloadPath],
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

function stripRuntimeOnlyFields(result = {}) {
  const { requests: _requests, ...contract } = result;
  return contract;
}

const REQUEST_KEYS = ['model', 'reasoning_effort', 'max_tokens'];

function summarizeRequest(request = {}) {
  return Object.fromEntries(REQUEST_KEYS.filter((key) => key in request).map((key) => [key, request[key]]));
}

function summarizeJsRequests(requests = []) {
  return requests
    .map((request) => request?.body || request)
    .filter((request) => request && typeof request === 'object' && ('model' in request || 'max_tokens' in request))
    .map((request) => summarizeRequest(request));
}

function summarizePythonPlan(plan = {}) {
  const requests = Array.isArray(plan.requests) ? [...plan.requests] : [];
  const mergeTemplate = plan.merge?.requestTemplate;
  if (mergeTemplate && typeof mergeTemplate === 'object') requests.push(mergeTemplate);
  return requests.map((request) => summarizeRequest(request));
}

function compareRequestPlans(pythonPlan = {}, jsRequests = []) {
  const python = summarizePythonPlan(pythonPlan);
  const js = summarizeJsRequests(jsRequests);
  if (js.length === 0) return { ok: true, mismatches: [], python, js };
  const mismatches = [];
  if (python.length !== js.length) {
    mismatches.push({ key: 'requestPlan.requestCount', python: python.length, js: js.length });
  }
  for (let index = 0; index < Math.min(python.length, js.length); index += 1) {
    for (const key of REQUEST_KEYS) {
      if (key in js[index] && python[index]?.[key] !== js[index]?.[key]) {
        mismatches.push({
          key: `requestPlan.requests[${index}].${key}`,
          python: python[index]?.[key],
          js: js[index]?.[key],
        });
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches, python, js };
}

export async function compareDeepSeekAnalyzeMockRuntime({
  payload = DEFAULT_PAYLOAD,
  analysis = DEFAULT_ANALYSIS,
  raw = DEFAULT_RAW,
  runJsRuntime = runJsMockRuntime,
  runPythonNormalization,
  runPythonCommand,
  runPythonPlan = runPythonRequestPlan,
  runCompare = runPythonCommandReportComparison,
} = {}) {
  const runPython = runPythonCommand || runPythonNormalization || runPythonCommandRuntime;
  const jsRuntime = await runJsRuntime({ payload, analysis, raw });
  const python = await runPython({ payload, analysis, raw, config: DEFAULT_CONFIG });
  const js = stripRuntimeOnlyFields(jsRuntime);
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-mock-runtime-compare-'));
  let comparison;
  let payloadPath;
  let analysisPath;
  let jsReportPath;
  let pythonReportPath;
  try {
    payloadPath = join(tempDir, 'payload.json');
    analysisPath = join(tempDir, 'analysis.json');
    jsReportPath = join(tempDir, 'js-report.json');
    pythonReportPath = join(tempDir, 'python-report.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    await writeFile(pythonReportPath, JSON.stringify(python || {}, null, 2), 'utf8');
    comparison = await runCompare({
      payload,
      analysis,
      raw,
      config: DEFAULT_CONFIG,
      payloadPath,
      analysisPath,
      jsReportPath,
      pythonReportPath,
      js,
      python,
      jsRuntimeContract: js,
      pythonNormalization: python,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  const requestPlan = await runPythonPlan({ payload, analysis, raw, config: DEFAULT_CONFIG });
  const requestComparison = compareRequestPlans(requestPlan, jsRuntime.requests || []);
  const mismatches = [...comparison.mismatches, ...requestComparison.mismatches];
  return {
    ok: comparison.ok && requestComparison.ok,
    fixture: { payload, analysis, payloadPath, analysisPath, jsReportPath },
    js,
    python,
    requestPlan: {
      python: requestComparison.python,
      js: requestComparison.js,
    },
    requests: jsRuntime.requests || [],
    mismatches,
  };
}

async function main() {
  const result = await compareDeepSeekAnalyzeMockRuntime();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
