import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareTiebaCorpusUpdate, compareTiebaCorpusUpdateObjects } from './compareTiebaCorpusUpdate.js';

const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const EXISTING_MESSAGE = '\u65e7\u8d34\u5427\u8bc4\u8bba';
const NEW_MESSAGE = '\u65b0\u8d34\u5427\u8bc4\u8bba';

const UPDATE_SUMMARY = {
  changed: true,
  newCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
  corpusCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
  corpusRunAts: ['old-run', GENERATED_AT],
};

test('compareTiebaCorpusUpdateObjects compares JS and Python corpus summaries', () => {
  const result = compareTiebaCorpusUpdateObjects(
    { ok: true, ignored: true, ...UPDATE_SUMMARY },
    { ok: true, ignored: false, ...UPDATE_SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, UPDATE_SUMMARY);
  assert.deepEqual(result.js, UPDATE_SUMMARY);
});

test('compareTiebaCorpusUpdate compares JS and Python payload update contracts', async () => {
  const calls = [];
  const result = await compareTiebaCorpusUpdate({
    runJs: async ({ payload }) => {
      calls.push({ runner: 'js', generatedAt: payload.generatedAt });
      return { ok: true, ...UPDATE_SUMMARY };
    },
    runPython: async ({ payload }) => {
      calls.push({ runner: 'python', comments: payload.run.results[0].comments.length });
      return { ok: true, ...UPDATE_SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { runner: 'js', generatedAt: GENERATED_AT },
    { runner: 'python', comments: 2 },
  ]);
});
