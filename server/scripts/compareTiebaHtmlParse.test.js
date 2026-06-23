import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareTiebaHtmlParse, compareTiebaHtmlParseObjects } from './compareTiebaHtmlParse.js';

const THREADS_RESULT = {
  ok: true,
  mode: 'threads',
  threads: [
    {
      id: '1234567890',
      kind: 'tieba-thread',
      title: 'sample thread',
      keyword: 'sample',
      sourceUrl: 'https://tieba.baidu.com/p/1234567890',
    },
  ],
};
const THREADS_SUMMARY = {
  mode: THREADS_RESULT.mode,
  threads: THREADS_RESULT.threads,
};

test('compareTiebaHtmlParseObjects compares parser contract summary keys', () => {
  const result = compareTiebaHtmlParseObjects({ ...THREADS_RESULT, ignored: true }, { ...THREADS_RESULT, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, THREADS_SUMMARY);
  assert.deepEqual(result.js, THREADS_SUMMARY);
});

test('compareTiebaHtmlParse compares JS parser output with Python parser output', async () => {
  const calls = [];
  const result = await compareTiebaHtmlParse({
    runJs: async (context) => {
      calls.push({ js: context.payload.mode });
      return THREADS_RESULT;
    },
    runPython: async (context) => {
      calls.push({ python: context.payload.mode });
      return THREADS_RESULT;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: 'threads' }, { python: 'threads' }]);
});
