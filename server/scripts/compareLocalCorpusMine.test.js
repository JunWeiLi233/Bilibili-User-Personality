import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareLocalCorpusMine,
  compareLocalCorpusMineObjects,
  compareLocalCorpusMineSuite,
  summarizeLocalCorpusMineResult,
} from './compareLocalCorpusMine.js';

const EVIDENCE_TERM = '\u8003\u636e\u5462';
const EVIDENCE_SAMPLE = '\u8003\u636e\u5462\uff1f\u6765\u6e90\u5728\u54ea\u91cc';

test('compareLocalCorpusMineObjects reports matching dry-run command summaries', () => {
  const fixture = {
    corpusComments: 2,
    targetTerms: [EVIDENCE_TERM],
    requireCommentBackedEvidence: true,
    targetEvidence: 3,
    maxSamplesPerTerm: 2,
    write: false,
    entryCount: 1,
    filteredEntryCount: 0,
    entries: [{ term: EVIDENCE_TERM, family: 'evidence', evidenceSamples: [EVIDENCE_SAMPLE] }],
  };

  const result = compareLocalCorpusMineObjects(fixture, { ...fixture, extra: 'ignored' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, fixture);
  assert.deepEqual(result.js, fixture);
});

test('compareLocalCorpusMineObjects reports command summary drift', () => {
  const result = compareLocalCorpusMineObjects(
    { corpusComments: 2, targetTerms: [EVIDENCE_TERM], entryCount: 1, entries: [{ term: EVIDENCE_TERM }] },
    { corpusComments: 1, targetTerms: [], entryCount: 0, entries: [] },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'corpusComments', python: 2, js: 1 },
    { key: 'targetTerms', python: [EVIDENCE_TERM], js: [] },
    { key: 'entryCount', python: 1, js: 0 },
    { key: 'entries', python: [{ term: EVIDENCE_TERM }], js: [] },
  ]);
});

test('summarizeLocalCorpusMineResult keeps stable comparison keys only', () => {
  assert.deepEqual(
    summarizeLocalCorpusMineResult({
      ok: true,
      dictionaryPath: 'tmp/dictionary.json',
      corpusFiles: ['tmp/comments.json'],
      corpusComments: 1,
      write: false,
      entries: [],
      ignored: true,
    }),
    {
      corpusComments: 1,
      write: false,
      entries: [],
    },
  );
});

test('compareLocalCorpusMine supports write-mode command parity', async () => {
  const result = await compareLocalCorpusMine({ write: true });

  assert.equal(result.ok, true);
  assert.equal(result.js.write, true);
  assert.equal(result.python.write, true);
  assert.equal(result.js.dictionaryBefore, 2);
  assert.equal(result.js.dictionaryAfter, 2);
  assert.deepEqual(result.mismatches, []);
});

test('compareLocalCorpusMineSuite validates dry-run and write-mode parity', async () => {
  const result = await compareLocalCorpusMineSuite();

  assert.equal(result.ok, true);
  assert.equal(result.dryRun.js.write, false);
  assert.equal(result.writeRun.js.write, true);
  assert.deepEqual(result.mismatches, []);
});
