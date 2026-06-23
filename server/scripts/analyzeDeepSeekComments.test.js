import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPlan, parseArgs, runPlanMode } from './analyzeDeepSeekComments.js';

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
