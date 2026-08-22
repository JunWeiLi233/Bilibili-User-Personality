import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVideoKeywordDiscoveryReport,
  compareVideoKeywordDiscoveryReportObjects,
  compareVideoKeywordDiscoveryReportSuite,
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

test('compareVideoKeywordDiscoveryReport runs the rich discovery fixture through Python', async () => {
  const result = await compareVideoKeywordDiscoveryReport({ fixture: 'rich-discovery' });

  assert.equal(result.ok, true);
  assert.equal(result.fixture.name, 'rich-discovery');
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.report.rounds[0].results[0].videos[0].bvid, 'BV1RichAAA11');
  assert.equal(result.python.report.rounds[0].results[0].comments, 2);
  assert.equal(result.python.report.rounds[0].results[0].acceptedEvidenceCount, 2);
  assert.deepEqual(result.python.priorityActionItems.map((item) => item.query), ['doge hot 评论区', 'doge hot 弹幕']);
});

test('compareVideoKeywordDiscoveryReport runs the danmaku discovery fixture through Python', async () => {
  const result = await compareVideoKeywordDiscoveryReport({ fixture: 'danmaku-discovery' });

  assert.equal(result.ok, true);
  assert.equal(result.fixture.name, 'danmaku-discovery');
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.report.rounds[0].results[0].videos[0].bvid, 'BV1Danmaku11');
  assert.equal(result.python.report.rounds[0].results[0].comments, 1);
  assert.equal(result.python.report.rounds[0].results[0].acceptedEvidenceCount, 1);
  assert.equal(result.python.report.rounds[0].results[0].existingDictionaryEvidence[0].evidenceSources[0].source, 'Bilibili public video danmaku scan');
});

test('compareVideoKeywordDiscoveryReportSuite runs default and rich fixtures', async () => {
  const result = await compareVideoKeywordDiscoveryReportSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default', 'rich-discovery', 'danmaku-discovery']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
});
