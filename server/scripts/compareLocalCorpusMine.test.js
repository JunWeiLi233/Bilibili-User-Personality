import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareLocalCorpusMineObjects,
  summarizeLocalCorpusMineResult,
} from './compareLocalCorpusMine.js';

test('compareLocalCorpusMineObjects reports matching dry-run command summaries', () => {
  const fixture = {
    corpusComments: 2,
    targetTerms: ['考据呢'],
    requireCommentBackedEvidence: true,
    targetEvidence: 3,
    maxSamplesPerTerm: 2,
    write: false,
    entryCount: 1,
    filteredEntryCount: 0,
    entries: [{ term: '考据呢', family: 'evidence', evidenceSamples: ['考据呢？来源在哪里'] }],
  };

  const result = compareLocalCorpusMineObjects(fixture, { ...fixture, extra: 'ignored' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, fixture);
  assert.deepEqual(result.js, fixture);
});

test('compareLocalCorpusMineObjects reports command summary drift', () => {
  const result = compareLocalCorpusMineObjects(
    { corpusComments: 2, targetTerms: ['考据呢'], entryCount: 1, entries: [{ term: '考据呢' }] },
    { corpusComments: 1, targetTerms: [], entryCount: 0, entries: [] },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    { key: 'corpusComments', python: 2, js: 1 },
    { key: 'targetTerms', python: ['考据呢'], js: [] },
    { key: 'entryCount', python: 1, js: 0 },
    { key: 'entries', python: [{ term: '考据呢' }], js: [] },
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
