import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDeepSeekAnalyzeMockRuntime } from './compareDeepSeekAnalyzeMockRuntime.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
  raw: '{}',
};

test('compareDeepSeekAnalyzeMockRuntime compares mocked service runtime to Python normalization', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonNormalization: async (payload) => {
      calls.push({ python: payload });
      return NORMALIZED;
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js, NORMALIZED);
  assert.deepEqual(result.python, NORMALIZED);
  assert.equal(calls.length, 2);
});

test('compareDeepSeekAnalyzeMockRuntime passes mock analysis through the Python command runtime', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async (payload) => {
      calls.push({ js: payload });
      return NORMALIZED;
    },
    runPythonCommand: async (payload) => {
      calls.push({ pythonCommand: payload });
      return NORMALIZED;
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[1])[0], 'pythonCommand');
});

test('compareDeepSeekAnalyzeMockRuntime reports request plan drift', async () => {
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async () => ({
      ...NORMALIZED,
      requests: [
        {
          body: {
            model: 'deepseek-v4-flash',
            reasoning_effort: 'max',
            max_tokens: 999,
          },
        },
      ],
    }),
    runPythonCommand: async () => NORMALIZED,
    runCompare: async () => ({ ok: true, mismatches: [] }),
    runPythonPlan: async () => ({
      ok: true,
      mode: 'single',
      requests: [
        {
          model: 'deepseek-v4-flash',
          reasoning_effort: 'max',
          max_tokens: 2000,
        },
      ],
    }),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'requestPlan.requests[0].max_tokens',
      python: 2000,
      js: 999,
    },
  ]);
});

test('compareDeepSeekAnalyzeMockRuntime delegates normalized report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeMockRuntime({
    runJsRuntime: async () => ({ ...NORMALIZED, requests: [] }),
    runPythonCommand: async () => NORMALIZED,
    runPythonPlan: async () => ({ ok: true, mode: 'single', requests: [] }),
    runCompare: async (context) => {
      calls.push({
        model: context.config.model,
        reasoningEffort: context.config.reasoningEffort,
        hasRaw: typeof context.raw === 'string' && context.raw.length > 0,
        jsConfidence: context.jsRuntimeContract.confidence,
        pythonConfidence: context.pythonNormalization.confidence,
        hasPythonReportPath: context.pythonReportPath.endsWith('python-report.json'),
        hasPayloadPath: context.payloadPath.endsWith('payload.json'),
        hasAnalysisPath: context.analysisPath.endsWith('analysis.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-mock-runtime' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'delegated', python: 'python-contract', js: 'js-mock-runtime' }]);
  assert.deepEqual(calls, [
    {
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      hasRaw: true,
      jsConfidence: 0.92,
      pythonConfidence: 0.92,
      hasPythonReportPath: true,
      hasPayloadPath: true,
      hasAnalysisPath: true,
      hasJsReportPath: true,
    },
  ]);
});
