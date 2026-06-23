import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareDeepSeekAnalyzeCommand,
  compareDeepSeekAnalyzeCommandMockRuntime,
  compareDeepSeekAnalyzeCommandSuite,
  compareDeepSeekAnalyzeCommandObjects,
} from './compareDeepSeekAnalyzeCommand.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
};

test('compareDeepSeekAnalyzeCommandObjects reports fixture command parity', () => {
  const result = compareDeepSeekAnalyzeCommandObjects(NORMALIZED, { ...NORMALIZED, ignored: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, NORMALIZED);
  assert.deepEqual(result.js, NORMALIZED);
});

test('compareDeepSeekAnalyzeCommand compares JS and Python fixture commands', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeCommand({
    runJsCommand: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonCommand: async (payload) => {
      calls.push({ python: payload });
      return NORMALIZED;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareDeepSeekAnalyzeCommandMockRuntime compares JS command mock runtime to Python command', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeCommandMockRuntime({
    runJsCommand: async (payload) => {
      calls.push({ js: payload });
      return { ...NORMALIZED, runtime: { mode: 'mock_chat' } };
    },
    runPythonCommand: async (payload) => {
      calls.push({ python: payload });
      return { ...NORMALIZED, runtime: { mode: 'mock_chat' } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareDeepSeekAnalyzeCommandSuite requires fixture command, mock runtime, env bridge, multiagent runtime, and live gate contract parity', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeCommandSuite({
    compareFixtureCommand: async () => {
      calls.push('fixtureCommand');
      return { ok: true, mismatches: [] };
    },
    compareCommandMockRuntime: async () => {
      calls.push('commandMockRuntime');
      return { ok: true, mismatches: [] };
    },
    compareMockRuntime: async (options) => {
      calls.push({ mockRuntime: options?.payload?.multiagent || false });
      return { ok: true, mismatches: [] };
    },
    compareEnvPythonRuntimeBridge: async () => {
      calls.push('envPythonRuntimeBridge');
      return { ok: true, mismatches: [] };
    },
    compareLiveGate: async () => {
      calls.push('liveValidationGate');
      return { ok: true, mismatches: [], python: { status: 'skipped' } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, ['fixtureCommand', 'commandMockRuntime', { mockRuntime: false }, { mockRuntime: true }, 'envPythonRuntimeBridge', 'liveValidationGate']);
  assert.deepEqual(Object.keys(result.checks), [
    'fixtureCommand',
    'commandMockRuntime',
    'mockRuntime',
    'multiagentMockRuntime',
    'envPythonRuntimeBridge',
    'liveValidationGate',
  ]);
});
