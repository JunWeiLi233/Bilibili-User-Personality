import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TIEBA_HTML_PARSE_FIXTURES, compareTiebaHtmlParse, compareTiebaHtmlParseObjects } from './compareTiebaHtmlParse.js';

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

test('compareTiebaHtmlParse exports named parser fixtures', async () => {
  assert.deepEqual(Object.keys(TIEBA_HTML_PARSE_FIXTURES), [
    'threads-title-dedupe',
    'thread-comments-data-field',
    'discovery-comments-from-threads',
  ]);

  const calls = [];
  const result = await compareTiebaHtmlParse({
    fixtureNames: Object.keys(TIEBA_HTML_PARSE_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, mode: context.payload.mode });
      return context.fixture.expected;
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, mode: context.payload.mode });
      return context.fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'threads-title-dedupe', mode: 'threads' },
    { python: 'threads-title-dedupe', mode: 'threads' },
    { js: 'thread-comments-data-field', mode: 'comments' },
    { python: 'thread-comments-data-field', mode: 'comments' },
    { js: 'discovery-comments-from-threads', mode: 'discovery-comments' },
    { python: 'discovery-comments-from-threads', mode: 'discovery-comments' },
  ]);
});
