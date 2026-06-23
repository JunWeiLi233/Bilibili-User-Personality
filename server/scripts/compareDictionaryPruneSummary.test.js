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
