import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOCAL_CORPUS_EVIDENCE_FIXTURES, compareLocalCorpusEvidence, compareLocalCorpusEvidenceObjects } from './compareLocalCorpusEvidence.js';

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

test('compareLocalCorpusEvidence exports named local evidence shape fixtures', async () => {
  assert.deepEqual(Object.keys(LOCAL_CORPUS_EVIDENCE_FIXTURES), [
    'target-term-match',
    'weak-term-ranking',
    'source-backfill',
    'flattened-corpus-payload',
  ]);

  const calls = [];
  const result = await compareLocalCorpusEvidence({
    fixtureNames: Object.keys(LOCAL_CORPUS_EVIDENCE_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('local-evidence.json') });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('local-evidence.json') });
      return context.fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'target-term-match', hasPayloadPath: true },
    { python: 'target-term-match', hasPayloadPath: true },
    { js: 'weak-term-ranking', hasPayloadPath: true },
    { python: 'weak-term-ranking', hasPayloadPath: true },
    { js: 'source-backfill', hasPayloadPath: true },
    { python: 'source-backfill', hasPayloadPath: true },
    { js: 'flattened-corpus-payload', hasPayloadPath: true },
    { python: 'flattened-corpus-payload', hasPayloadPath: true },
  ]);
});
