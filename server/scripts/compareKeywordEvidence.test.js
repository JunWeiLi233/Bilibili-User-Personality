import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareKeywordEvidence, compareKeywordEvidenceObjects } from './compareKeywordEvidence.js';

const ENTRIES = [
  {
    term: 'yygq',
    family: 'attack',
    meaning: 'Chinese initialism',
    evidenceCount: 2,
    evidenceSamples: ['YYGQ once', 'yygq twice'],
    evidenceSources: [
      { source: 'Bilibili public comment target expansion', uid: 'mid-1', sample: 'YYGQ once' },
      { source: 'Bilibili public comment target expansion', uid: 'mid-1', sample: 'yygq twice' },
    ],
  },
];

test('compareKeywordEvidenceObjects reports matching keyword evidence summaries', () => {
  const result = compareKeywordEvidenceObjects(
    { ok: true, mode: 'entries', count: 1, entries: ENTRIES, ignored: true },
    { ok: true, mode: 'entries', count: 1, entries: ENTRIES },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { ok: true, mode: 'entries', count: 1, entries: ENTRIES });
  assert.deepEqual(result.js, { ok: true, mode: 'entries', count: 1, entries: ENTRIES });
});

test('compareKeywordEvidence compares JS-compatible and Python keyword evidence reports', async () => {
  const calls = [];
  const result = await compareKeywordEvidence({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('keyword-evidence.json') });
      return { ok: true, mode: 'entries', count: 1, entries: ENTRIES };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('keyword-evidence.json') });
      return { ok: true, mode: 'entries', count: 1, entries: ENTRIES };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});
