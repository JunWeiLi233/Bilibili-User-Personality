import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEEPSEEK_ANALYZE_PLAN_FIXTURES,
  compareDeepSeekAnalyzePlan,
  comparePlanObjects,
} from './compareDeepSeekAnalyzePlan.js';

const DEFAULT_PLAN = {
  ok: true,
  payload: { text: 'satire [doge] extra sentence', uid: '42', multiagent: true },
  input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
};

test('compareDeepSeekAnalyzePlan reports matching JS and Python dry-run plans', async () => {
  const result = await compareDeepSeekAnalyzePlan({
    argv: ['--plan-json', '--text=satire [doge]', '--uid', '42', '--multiagent', 'extra sentence'],
    stdinIsTTY: true,
    runPythonPlan: async () => DEFAULT_PLAN,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js, DEFAULT_PLAN);
  assert.deepEqual(result.python, DEFAULT_PLAN);
});

test('compareDeepSeekAnalyzePlan delegates persisted report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzePlan({
    argv: ['--plan-json', '--text=satire [doge]', '--uid', '42'],
    stdinIsTTY: true,
    runPythonPlan: async () => ({
      ok: true,
      payload: { text: 'satire [doge]', uid: '42' },
      input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
    }),
    runCompare: async (context) => {
      calls.push({
        pythonText: context.pythonPlan.payload.text,
        jsText: context.jsPlan.payload.text,
        hasPayloadPath: context.payloadPath.endsWith('payload.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'delegated', python: 'python-contract', js: 'js-bridge' }]);
  assert.deepEqual(calls, [
    {
      pythonText: 'satire [doge]',
      jsText: 'satire [doge]',
      hasPayloadPath: true,
      hasJsReportPath: true,
    },
  ]);
});

test('comparePlanObjects reports payload and input drift using Python/JS keys', () => {
  const result = comparePlanObjects(
    {
      ok: true,
      payload: { text: 'new text', uid: '42' },
      input: { source: 'argv', file: '', readsStdin: false, showHelp: false },
    },
    {
      ok: true,
      payload: { text: 'old text' },
      input: { source: 'stdin' },
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'payload', python: { text: 'new text', uid: '42' }, js: { text: 'old text' } },
    {
      key: 'input',
      python: { source: 'argv', file: '', readsStdin: false, showHelp: false },
      js: { source: 'stdin' },
    },
  ]);
});

test('compareDeepSeekAnalyzePlan exports named CLI route fixtures', async () => {
  assert.deepEqual(Object.keys(DEEPSEEK_ANALYZE_PLAN_FIXTURES), [
    'argv-text-multiagent',
    'stdin-pipe',
    'file-source',
    'payload-source',
    'help-source',
  ]);

  const calls = [];
  const result = await compareDeepSeekAnalyzePlan({
    fixtureNames: Object.keys(DEEPSEEK_ANALYZE_PLAN_FIXTURES),
    runPythonPlan: async ({ fixture, argv, stdinIsTTY }) => {
      calls.push({ fixture: fixture.name, argv, stdinIsTTY });
      return fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(
    calls.map((call) => ({ fixture: call.fixture, stdinIsTTY: call.stdinIsTTY })),
    [
      { fixture: 'argv-text-multiagent', stdinIsTTY: true },
      { fixture: 'stdin-pipe', stdinIsTTY: false },
      { fixture: 'file-source', stdinIsTTY: true },
      { fixture: 'payload-source', stdinIsTTY: false },
      { fixture: 'help-source', stdinIsTTY: true },
    ],
  );
  assert.deepEqual(calls[0].argv, ['--plan-json', '--text=satire [doge]', '--uid', '42', '--multiagent', 'extra sentence']);
  assert.deepEqual(calls[3].argv, ['--plan-json', '--payload', 'analysis-payload.json']);
});
