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
  compareNormalizationObjects,
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

function stripRuntimeOnlyFields(result = {}) {
  const { requests: _requests, ...contract } = result;
  return contract;
}

export async function compareDeepSeekAnalyzeMockRuntime({
  payload = DEFAULT_PAYLOAD,
  analysis = DEFAULT_ANALYSIS,
  raw = DEFAULT_RAW,
  runJsRuntime = runJsMockRuntime,
  runPythonNormalization,
  runPythonCommand,
} = {}) {
  const runPython = runPythonCommand || runPythonNormalization || runPythonCommandRuntime;
  const jsRuntime = await runJsRuntime({ payload, analysis, raw });
  const python = await runPython({ payload, analysis, raw, config: DEFAULT_CONFIG });
  const js = stripRuntimeOnlyFields(jsRuntime);
  const comparison = compareNormalizationObjects(python, js);
  return {
    ok: comparison.ok,
    fixture: { payload, analysis },
    js,
    python,
    requests: jsRuntime.requests || [],
    mismatches: comparison.mismatches,
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
