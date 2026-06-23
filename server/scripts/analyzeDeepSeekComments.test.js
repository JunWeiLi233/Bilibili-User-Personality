import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildPlan, parseArgs, readAnalysisFixtureJson, runFixtureAnalysisMode, runPlanMode } from './analyzeDeepSeekComments.js';

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
