import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildPlan,
  buildPythonRuntimeArgs,
  parseArgs,
  prepareAnalysisInput,
  readAnalysisFixtureJson,
  runFixtureAnalysisMode,
  runLiveAnalysisMode,
  runPlanMode,
} from './analyzeDeepSeekComments.js';

test('analyzeDeepSeekComments builds JS/Python comparable dry-run plan', () => {
  const parsed = parseArgs(['--plan-json', '--text=satire [doge]', '--uid', '42', '--multiagent', 'extra sentence']);

  assert.equal(parsed.planJson, true);
  assert.deepEqual(buildPlan(parsed, { stdinIsTTY: true }), {
    ok: true,
    payload: { text: 'satire [doge] extra sentence', uid: '42', multiagent: true },
    input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
  });
});

test('analyzeDeepSeekComments dry-run plan marks stdin without consuming it', () => {
  const parsed = parseArgs(['--plan-json']);

  assert.deepEqual(buildPlan(parsed, { stdinIsTTY: false }), {
    ok: true,
    payload: {},
    input: { source: 'stdin', file: '', readsStdin: true, showHelp: false },
  });
});

test('analyzeDeepSeekComments delegates dry-run planning to Python by default', async () => {
  const argv = ['--plan-json', '--text=satire [doge]'];
  const parsed = parseArgs(argv);
  const calls = [];

  const result = await runPlanMode(parsed, {
    argv,
    stdinIsTTY: true,
    runPythonPlan: async (payload) => {
      calls.push(payload);
      return {
        ok: true,
        payload: { text: 'satire [doge]' },
        input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
      };
    },
  });

  assert.equal(parsed.usePythonPlan, true);
  assert.equal(parsed.useJsPlan, false);
  assert.deepEqual(calls, [{ argv, stdinIsTTY: true }]);
  assert.deepEqual(result, {
    ok: true,
    payload: { text: 'satire [doge]' },
    input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
  });
});

test('analyzeDeepSeekComments keeps explicit JS dry-run planning fallback', async () => {
  const argv = ['--plan-json', '--js-plan', '--text=satire [doge]'];
  const parsed = parseArgs(argv);
  const calls = [];

  const result = await runPlanMode(parsed, {
    argv,
    stdinIsTTY: true,
    runPythonPlan: async (payload) => {
      calls.push(payload);
      return { ok: false };
    },
  });

  assert.equal(parsed.usePythonPlan, false);
  assert.equal(parsed.useJsPlan, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    ok: true,
    payload: { text: 'satire [doge]' },
    input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
  });
});

test('analyzeDeepSeekComments parses fixture analysis mode for Python-owned normalization', () => {
  const parsed = parseArgs(['--fixture-analysis', 'analysis.json', '--text=satire [doge]', '--uid', '42']);

  assert.equal(parsed.fixtureAnalysis, 'analysis.json');
  assert.equal(parsed.usePythonFixture, true);
  assert.equal(parsed.useJsFixture, false);
  assert.deepEqual(parsed.payload, { text: 'satire [doge]', uid: '42' });
});

test('analyzeDeepSeekComments delegates fixture analysis normalization to Python by default', async () => {
  const calls = [];

  const result = await runFixtureAnalysisMode(
    {
      payload: { text: '狗头保命[doge]' },
      fixtureAnalysis: 'analysis.json',
      usePythonFixture: true,
      useJsFixture: false,
    },
    {
      readAnalysis: async (path) => {
        calls.push({ read: path });
        return { parsed: { confidence: 2 } };
      },
      runPythonFixture: async (payload) => {
        calls.push({ python: payload });
        return { ok: true, confidence: 0.92 };
      },
    },
  );

  assert.deepEqual(result, { ok: true, confidence: 0.92 });
  assert.deepEqual(calls, [
    { read: 'analysis.json' },
    {
      python: {
        payload: { text: '狗头保命[doge]' },
        analysis: { parsed: { confidence: 2 } },
      },
    },
  ]);
});

test('analyzeDeepSeekComments keeps explicit JS fixture normalization fallback', async () => {
  const result = await runFixtureAnalysisMode(
    {
      payload: { text: '狗头保命[doge]' },
      fixtureAnalysis: 'analysis.json',
      usePythonFixture: false,
      useJsFixture: true,
    },
    {
      readAnalysis: async () => ({ parsed: { confidence: 2 } }),
      normalizeJs: () => ({ ok: true, confidence: 0.92 }),
      runPythonFixture: async () => ({ ok: false }),
    },
  );

  assert.deepEqual(result, { ok: true, confidence: 0.92 });
});

test('analyzeDeepSeekComments reads UTF-8 BOM fixture analysis JSON', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-fixture-test-'));
  try {
    const fixturePath = join(tempDir, 'analysis.json');
    await writeFile(fixturePath, '\uFEFF{"parsed":{"confidence":2}}', 'utf8');

    assert.deepEqual(await readAnalysisFixtureJson(fixturePath), { parsed: { confidence: 2 } });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('analyzeDeepSeekComments parses mock chat analysis mode for Python-owned runtime', () => {
  const parsed = parseArgs(['--mock-chat-analysis', 'analysis.json', '--text=satire [doge]', '--multiagent']);

  assert.equal(parsed.mockChatAnalysis, 'analysis.json');
  assert.equal(parsed.usePythonRuntime, true);
  assert.equal(parsed.useJsRuntime, false);
  assert.deepEqual(parsed.payload, { text: 'satire [doge]', multiagent: true });
});

test('analyzeDeepSeekComments delegates mock chat runtime to Python by default', async () => {
  const calls = [];

  const result = await runLiveAnalysisMode(
    {
      payload: { text: 'satire [doge]', multiagent: true },
      mockChatAnalysis: 'analysis.json',
      usePythonRuntime: true,
      useJsRuntime: false,
    },
    {
      runPythonRuntime: async (payload) => {
        calls.push({ python: payload });
        return { ok: true, runtime: { mode: 'mock_chat', multiagent: true } };
      },
      analyzeJs: async () => ({ ok: false }),
    },
  );

  assert.deepEqual(result, { ok: true, runtime: { mode: 'mock_chat', multiagent: true } });
  assert.deepEqual(calls, [
    {
      python: {
        payload: { text: 'satire [doge]', multiagent: true },
        mockChatAnalysis: 'analysis.json',
      },
    },
  ]);
});

test('analyzeDeepSeekComments forwards file input to Python live runtime bridge', async () => {
  const calls = [];

  const result = await runLiveAnalysisMode(
    {
      payload: { multiagent: true },
      file: 'comments.txt',
      usePythonRuntime: true,
      useJsRuntime: false,
    },
    {
      runPythonRuntime: async (payload) => {
        calls.push({ python: payload });
        return { ok: true, runtime: { mode: 'live_file' } };
      },
      analyzeJs: async () => ({ ok: false }),
    },
  );

  assert.deepEqual(result, { ok: true, runtime: { mode: 'live_file' } });
  assert.deepEqual(calls, [
    {
      python: {
        payload: { multiagent: true },
        file: 'comments.txt',
        mockChatAnalysis: '',
      },
    },
  ]);
});

test('analyzeDeepSeekComments builds Python runtime args with file preferred over text', () => {
  assert.deepEqual(
    buildPythonRuntimeArgs({
      payload: { text: 'inline text', uid: '42', name: 'alice', multiagent: true },
      file: 'comments.txt',
      mockChatAnalysis: 'analysis.json',
    }),
    [
      '-m',
      'python_backend.cli.deepseek_analyze',
      '--file',
      'comments.txt',
      '--uid',
      '42',
      '--name',
      'alice',
      '--multiagent',
      '--mock-chat-analysis',
      'analysis.json',
    ],
  );
});

test('analyzeDeepSeekComments forwards model and reasoning effort to Python runtime args', () => {
  const parsed = parseArgs([
    '--python-runtime',
    '--text',
    'satire [doge]',
    '--model',
    'deepseek-v4-pro',
    '--reasoning-effort',
    'high',
  ]);

  assert.deepEqual(parsed.payload, {
    text: 'satire [doge]',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'high',
  });
  assert.deepEqual(
    buildPythonRuntimeArgs({
      payload: parsed.payload,
    }),
    [
      '-m',
      'python_backend.cli.deepseek_analyze',
      '--text',
      'satire [doge]',
      '--model',
      'deepseek-v4-pro',
      '--reasoning-effort',
      'high',
    ],
  );
});

test('analyzeDeepSeekComments does not pre-read file input for Python live runtime', async () => {
  const parsed = parseArgs(['--python-runtime', '--file', 'comments.txt', '--multiagent']);
  const calls = [];

  const result = await prepareAnalysisInput(parsed, {
    stdinIsTTY: true,
    readTextFile: async (path) => {
      calls.push(path);
      throw new Error('JS should not read Python-runtime file input');
    },
  });

  assert.equal(result, parsed);
  assert.deepEqual(calls, []);
  assert.deepEqual(parsed.payload, { multiagent: true });
  assert.equal(parsed.file, 'comments.txt');
});

test('analyzeDeepSeekComments keeps JS runtime file reading behavior', async () => {
  const parsed = parseArgs(['--js-runtime', '--file', 'comments.txt']);
  const calls = [];

  const result = await prepareAnalysisInput(parsed, {
    stdinIsTTY: true,
    readTextFile: async (path, encoding) => {
      calls.push({ path, encoding });
      return 'satire [doge]';
    },
  });

  assert.equal(result, parsed);
  assert.deepEqual(calls, [{ path: 'comments.txt', encoding: 'utf8' }]);
  assert.deepEqual(parsed.payload, { text: 'satire [doge]' });
});

test('analyzeDeepSeekComments keeps explicit JS live runtime fallback', async () => {
  const calls = [];

  const result = await runLiveAnalysisMode(
    {
      payload: { text: 'satire [doge]' },
      usePythonRuntime: false,
      useJsRuntime: true,
    },
    {
      runPythonRuntime: async () => ({ ok: false }),
      analyzeJs: async (payload) => {
        calls.push(payload);
        return { ok: true, provider: 'deepseek' };
      },
    },
  );

  assert.deepEqual(result, { ok: true, provider: 'deepseek' });
  assert.deepEqual(calls, [{ text: 'satire [doge]' }]);
});

test('analyzeDeepSeekComments can opt into Python live runtime from environment', async () => {
  const parsed = parseArgs(['--text=satire [doge]', '--multiagent'], {
    BILIBILI_DEEPSEEK_ANALYZE_USE_PYTHON_RUNTIME: '1',
  });
  const calls = [];

  const result = await runLiveAnalysisMode(parsed, {
    runPythonRuntime: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, runtime: { mode: 'live_multiagent', multiagent: true } };
    },
    analyzeJs: async () => ({ ok: false }),
  });

  assert.equal(parsed.usePythonRuntime, true);
  assert.equal(parsed.useJsRuntime, false);
  assert.deepEqual(result, { ok: true, runtime: { mode: 'live_multiagent', multiagent: true } });
  assert.deepEqual(calls, [
    {
      python: {
        payload: { text: 'satire [doge]', multiagent: true },
        mockChatAnalysis: '',
      },
    },
  ]);
});
