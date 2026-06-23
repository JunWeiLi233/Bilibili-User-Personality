import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVideoKeywordDiscoveryReport,
  compareVideoKeywordDiscoveryReportObjects,
} from './compareVideoKeywordDiscoveryReport.js';

test('compareVideoKeywordDiscoveryReportObjects reports discovery report drift', () => {
  const result = compareVideoKeywordDiscoveryReportObjects(
    {
      mode: 'report',
      report: { generatedAt: '2026-06-23T00:00:00.000Z' },
      priorityActionItems: [{ query: 'doge hot' }],
      ignored: true,
    },
    {
      mode: 'report',
      report: { generatedAt: 'wrong' },
      priorityActionItems: [],
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'report',
      python: { generatedAt: '2026-06-23T00:00:00.000Z' },
      js: { generatedAt: 'wrong' },
    },
    {
      key: 'priorityActionItems',
      python: [{ query: 'doge hot' }],
      js: [],
    },
  ]);
  assert.deepEqual(result.python, {
    mode: 'report',
    report: { generatedAt: '2026-06-23T00:00:00.000Z' },
    priorityActionItems: [{ query: 'doge hot' }],
  });
});

test('compareVideoKeywordDiscoveryReport compares injected JS and Python report runners', async () => {
  const result = await compareVideoKeywordDiscoveryReport({
    payload: { generatedAt: '2026-06-23T00:00:00.000Z', result: { rounds: [] } },
    runJs: async () => ({ mode: 'report', report: { generatedAt: 'same' }, priorityActionItems: [] }),
    runPython: async () => ({ mode: 'report', report: { generatedAt: 'same' }, priorityActionItems: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});
