import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareDictionaryPruneSummary,
  compareDictionaryPruneSummaryObjects,
} from './compareDictionaryPruneSummary.js';

const SUMMARY = {
  ok: true,
  entries: { before: 3, after: 2, removed: 1 },
  asciiTerms: { before: 2, after: 1, removed: 1 },
  summary: { totalEntries: 3, asciiEntries: 2, afterEntries: 2, afterAsciiEntries: 1 },
};

test('compareDictionaryPruneSummaryObjects reports matching prune summaries', () => {
  const result = compareDictionaryPruneSummaryObjects(SUMMARY, { ...SUMMARY, ignored: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, {
    entries: SUMMARY.entries,
    asciiTerms: SUMMARY.asciiTerms,
    summary: SUMMARY.summary,
  });
});

test('compareDictionaryPruneSummary compares JS and Python fixture summaries', async () => {
  const calls = [];
  const result = await compareDictionaryPruneSummary({
    runJsSummary: async (payload) => {
      calls.push({ js: payload });
      return SUMMARY;
    },
    runPythonSummary: async (payload) => {
      calls.push({ python: payload });
      return SUMMARY;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareDictionaryPruneSummary compares write-mode persisted dictionary terms', async () => {
  const result = await compareDictionaryPruneSummary({
    write: true,
    dictionary: {
      entries: [
        { term: 'doge', family: 'attack', meaning: 'ascii emoji name noise' },
        { term: 'YYGQ', family: 'attack', meaning: 'allowed pinyin acronym', evidenceSamples: ['\u9634\u9633\u602a\u6c14'] },
        { term: '\u9634\u9633\u602a\u6c14', family: 'attack', meaning: 'satirical tone' },
        { term: 'md5', family: 'evasion', meaning: 'random ascii hash fragment' },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.persisted, {
    jsTerms: ['yygq', '\u9634\u9633\u602a\u6c14'],
    pythonTerms: ['yygq', '\u9634\u9633\u602a\u6c14'],
  });
  assert.equal(result.python.write, true);
  assert.equal(result.python.writeResult.entries, 2);
});
