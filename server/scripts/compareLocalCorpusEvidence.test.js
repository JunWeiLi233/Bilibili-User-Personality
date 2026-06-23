import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareLocalCorpusEvidence, compareLocalCorpusEvidenceObjects } from './compareLocalCorpusEvidence.js';

const SUMMARY = {
  count: 1,
  terms: ['查查资料'],
  evidence: { 查查资料: ['你先查查资料再说'] },
};

test('compareLocalCorpusEvidenceObjects reports matching evidence summaries', () => {
  const result = compareLocalCorpusEvidenceObjects(
    { ok: true, entries: [{ term: '查查资料', evidence: ['你先查查资料再说'] }] },
    { ok: true, count: 1, entries: [{ term: '查查资料', evidenceSamples: ['你先查查资料再说'] }] },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareLocalCorpusEvidence compares JS-compatible and Python evidence reports', async () => {
  const calls = [];
  const result = await compareLocalCorpusEvidence({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('local-evidence.json') });
      return { ok: true, count: 1, entries: [{ term: '查查资料', evidenceSamples: ['你先查查资料再说'] }] };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('local-evidence.json') });
      return { ok: true, count: 1, entries: [{ term: '查查资料', evidence: ['你先查查资料再说'] }] };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});
