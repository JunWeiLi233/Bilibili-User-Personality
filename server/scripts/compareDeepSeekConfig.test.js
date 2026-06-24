import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEEPSEEK_CONFIG_FIXTURES,
  compareDeepSeekConfig,
  compareDeepSeekConfigObjects,
} from './compareDeepSeekConfig.js';

test('compareDeepSeekConfigObjects reports config drift', () => {
  const result = compareDeepSeekConfigObjects(
    { ok: true, provider: 'deepseek', model: 'deepseek-v4-pro', keyConfigured: true },
    { ok: true, provider: 'deepseek', model: 'deepseek-v4-flash', keyConfigured: true },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'model',
      python: 'deepseek-v4-pro',
      js: 'deepseek-v4-flash',
    },
  ]);
});

test('compareDeepSeekConfig compares injected JS and Python config runners', async () => {
  const result = await compareDeepSeekConfig({
    payload: {
      env: { DEEPSEEK_API_KEY: 'secret', DEEPSEEK_MODEL: 'missing-model' },
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    },
    runJs: async () => ({ ok: true, provider: 'deepseek', model: 'deepseek-v4-pro', keyConfigured: true }),
    runPython: async () => ({ ok: true, provider: 'deepseek', model: 'deepseek-v4-pro', keyConfigured: true }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});

test('compareDeepSeekConfig delegates saved JS report comparison to Python contract', async () => {
  let compareContext;
  const report = { ok: true, provider: 'deepseek', model: 'deepseek-v4-pro', keyConfigured: true };
  const result = await compareDeepSeekConfig({
    payload: {
      env: { DEEPSEEK_API_KEY: 'secret', DEEPSEEK_MODEL: 'missing-model' },
      models: ['deepseek-v4-pro'],
    },
    runJs: async () => report,
    runPython: async () => report,
    runCompare: async (context) => {
      compareContext = context;
      return {
        ok: true,
        mismatches: [],
        python: report,
        js: report,
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsReportPath.endsWith('js-report.json'), true);
  assert.deepEqual(compareContext.jsReport, report);
  assert.deepEqual(compareContext.pythonReport, report);
});

test('compareDeepSeekConfig exports named config fixtures', async () => {
  assert.deepEqual(Object.keys(DEEPSEEK_CONFIG_FIXTURES), [
    'no-api-key',
    'model-list-fallback',
    'model-list-warning',
  ]);

  const calls = [];
  const result = await compareDeepSeekConfig({
    fixtureNames: Object.keys(DEEPSEEK_CONFIG_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { ok: true, provider: 'deepseek', model: 'deepseek-v4-pro' };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { ok: true, provider: 'deepseek', model: 'deepseek-v4-pro' };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'no-api-key', hasPayloadPath: true },
    { python: 'no-api-key', hasPayloadPath: true },
    { js: 'model-list-fallback', hasPayloadPath: true },
    { python: 'model-list-fallback', hasPayloadPath: true },
    { js: 'model-list-warning', hasPayloadPath: true },
    { python: 'model-list-warning', hasPayloadPath: true },
  ]);
});
