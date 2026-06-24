import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getDeepSeekConfig } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = [
  'ok',
  'provider',
  'baseUrl',
  'model',
  'configuredModel',
  'reasoningEffort',
  'available',
  'keyConfigured',
  'models',
  'error',
  'warning',
];

export const DEEPSEEK_CONFIG_FIXTURES = {
  'no-api-key': {
    env: {
      DEEPSEEK_BASE_URL: 'https://deepseek.example/',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_REASONING_EFFORT: 'invalid',
    },
  },
  'model-list-fallback': {
    env: {
      DEEPSEEK_API_KEY: 'secret',
      DEEPSEEK_MODEL: 'missing-model',
      DEEPSEEK_REASONING_EFFORT: 'xhigh',
    },
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  'model-list-warning': {
    env: {
      DEEPSEEK_API_KEY: 'secret',
      DEEPSEEK_MODEL: 'custom-model',
    },
    modelListError: 'HTTP 503',
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(DEEPSEEK_CONFIG_FIXTURES);

function summarizeConfig(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareDeepSeekConfigObjects(pythonResult = {}, jsResult = {}) {
  const python = summarizeConfig(pythonResult);
  const js = summarizeConfig(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function buildFixtureFetch(payload = {}) {
  return async () => {
    if (payload.modelListError) throw new Error(payload.modelListError);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: (payload.models || []).map((id) => ({ id })) }),
    };
  };
}

async function runJsConfig({ payload }) {
  return getDeepSeekConfig({
    env: payload?.env || {},
    fetch: buildFixtureFetch(payload),
  });
}

async function runPythonConfig({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.deepseek_config', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'no-api-key';
  return { name, payload: DEEPSEEK_CONFIG_FIXTURES[name] || DEEPSEEK_CONFIG_FIXTURES['no-api-key'] };
}

async function compareDeepSeekConfigSingle({ payload, fixture, runJs = runJsConfig, runPython = runPythonConfig } = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-config-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    const context = { payload: resolved.payload, fixture: { name: resolved.name }, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareDeepSeekConfigObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareDeepSeekConfig({ payload, fixture, fixtureNames, runJs = runJsConfig, runPython = runPythonConfig } = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareDeepSeekConfigSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareDeepSeekConfigSingle({ payload: payload || DEEPSEEK_CONFIG_FIXTURES['no-api-key'], fixture, runJs, runPython });
}

async function main() {
  const result = await compareDeepSeekConfig({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
