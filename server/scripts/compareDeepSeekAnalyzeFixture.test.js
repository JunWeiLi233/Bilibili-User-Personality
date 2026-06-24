import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDeepSeekAnalyzeFixture } from './compareDeepSeekAnalyzeFixture.js';

const NORMALIZED = {
  ok: true,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  axes: [],
  sentenceAnalyses: [],
  confidence: 0.92,
};

test('compareDeepSeekAnalyzeFixture compares full JS command fixture output to Python normalization', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeFixture({
    runJsFixture: async (payload) => {
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

test('compareDeepSeekAnalyzeFixture delegates persisted command report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareDeepSeekAnalyzeFixture({
    runJsFixture: async () => NORMALIZED,
    runPythonNormalization: async () => NORMALIZED,
    runCompare: async (context) => {
      calls.push({
        model: context.config.model,
        reasoningEffort: context.config.reasoningEffort,
        jsConfidence: context.jsFixture.confidence,
        pythonConfidence: context.pythonNormalization.confidence,
        hasPayloadPath: context.payloadPath.endsWith('payload.json'),
        hasAnalysisPath: context.analysisPath.endsWith('analysis.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
      });
      return {
        ok: false,
        mismatches: [{ key: 'delegated', python: 'python-contract', js: 'js-command' }],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'delegated', python: 'python-contract', js: 'js-command' }]);
  assert.deepEqual(calls, [
    {
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      jsConfidence: 0.92,
      pythonConfidence: 0.92,
      hasPayloadPath: true,
      hasAnalysisPath: true,
      hasJsReportPath: true,
    },
  ]);
});
