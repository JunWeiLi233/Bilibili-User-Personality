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

test('compareLocalCorpusEvidence delegates saved JS report comparison to Python contract', async () => {
  const calls = [];
  const result = await compareLocalCorpusEvidence({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('local-evidence.json') });
      return { ok: true, count: 1, entries: [{ term: 'alpha', evidenceSamples: ['alpha sample'] }] };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('local-evidence.json') });
      return { ok: true, count: 1, entries: [{ term: 'alpha', evidence: ['different sample'] }] };
    },
    runCompare: async (context) => {
      calls.push({
        compare: context.payloadPath.endsWith('local-evidence.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
        jsReport: context.jsReport.entries[0].evidenceSamples[0],
        pythonReport: context.pythonReport.entries[0].evidence[0],
      });
      return {
        ok: false,
        mismatches: [{ key: 'evidence', python: { alpha: ['different sample'] }, js: { alpha: ['alpha sample'] } }],
        python: { count: 1, terms: ['alpha'], evidence: { alpha: ['different sample'] } },
        js: { count: 1, terms: ['alpha'], evidence: { alpha: ['alpha sample'] } },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{ key: 'evidence', python: { alpha: ['different sample'] }, js: { alpha: ['alpha sample'] } }]);
  assert.deepEqual(calls, [
    { js: true },
    { python: true },
    {
      compare: true,
      hasJsReportPath: true,
      jsReport: 'alpha sample',
      pythonReport: 'different sample',
    },
  ]);
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
    runCompare: async () => ({ ok: true, mismatches: [] }),
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
