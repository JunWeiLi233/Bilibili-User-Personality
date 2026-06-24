import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HUGGINGFACE_CORPUS_FIXTURES,
  compareHuggingFaceCorpus,
  compareHuggingFaceCorpusObjects,
} from './compareHuggingFaceCorpus.js';

const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const EXISTING_MESSAGE = '\u65e7B\u7ad9\u8bc4\u8bba';
const NEW_MESSAGE = '\u65b0B\u7ad9\u5f39\u5e55[doge]';

const IMPORT_SUMMARY = {
  importedRows: 1,
  changed: true,
  addedComments: 1,
  corpusCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
  corpusRunAts: ['old-run', GENERATED_AT],
};

test('compareHuggingFaceCorpusObjects compares JS and Python import summaries', () => {
  const result = compareHuggingFaceCorpusObjects(
    { ok: true, ignored: true, ...IMPORT_SUMMARY },
    { ok: true, ignored: false, ...IMPORT_SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, IMPORT_SUMMARY);
  assert.deepEqual(result.js, IMPORT_SUMMARY);
});

test('compareHuggingFaceCorpus compares JS and Python HuggingFace import contracts', async () => {
  const calls = [];
  const result = await compareHuggingFaceCorpus({
    runJs: async ({ raw, payload }) => {
      calls.push({ runner: 'js', dataset: payload.dataset, rawLength: raw.length });
      return { ok: true, ...IMPORT_SUMMARY };
    },
    runPython: async ({ rawPath, existingPath }) => {
      calls.push({ runner: 'python', rawPath: Boolean(rawPath), existingPath: Boolean(existingPath) });
      return { ok: true, ...IMPORT_SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { runner: 'js', dataset: 'Midsummra/bilibilicomment', rawLength: 49 },
    { runner: 'python', rawPath: true, existingPath: true },
  ]);
});

test('compareHuggingFaceCorpus exports named import fixtures', async () => {
  assert.deepEqual(Object.keys(HUGGINGFACE_CORPUS_FIXTURES), [
    'bilibili-csv-import',
    'tieba-jsonl-title-detail',
    'kaggle-json-import-dedupe',
  ]);

  const calls = [];
  const result = await compareHuggingFaceCorpus({
    fixtureNames: Object.keys(HUGGINGFACE_CORPUS_FIXTURES),
    runJs: async ({ fixture }) => {
      calls.push({ js: fixture.name });
      return { ok: true, ...fixture.expected };
    },
    runPython: async ({ fixture }) => {
      calls.push({ python: fixture.name });
      return { ok: true, ...fixture.expected };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'bilibili-csv-import' },
    { python: 'bilibili-csv-import' },
    { js: 'tieba-jsonl-title-detail' },
    { python: 'tieba-jsonl-title-detail' },
    { js: 'kaggle-json-import-dedupe' },
    { python: 'kaggle-json-import-dedupe' },
  ]);
});
