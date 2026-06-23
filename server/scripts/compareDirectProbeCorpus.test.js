import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDirectProbeCorpus, DEFAULT_JS_REPORT } from './compareDirectProbeCorpus.js';

test('compareDirectProbeCorpus compares Python against the injected JS direct-probe runner output', async () => {
  const calls = [];
  const result = await compareDirectProbeCorpus({
    runJs: async ({ payload }) => {
      calls.push({ runner: 'js', comments: payload.comments.length });
      return DEFAULT_JS_REPORT;
    },
    runPython: async ({ jsReport }) => {
      calls.push({ runner: 'python', jsComments: jsReport.corpus.comments.length });
      return {
        ok: true,
        js: { commentMessages: jsReport.corpus.comments.map((comment) => comment.message) },
        python: { commentMessages: jsReport.corpus.comments.map((comment) => comment.message) },
        mismatches: [],
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { runner: 'js', comments: 3 },
    { runner: 'python', jsComments: 2 },
  ]);
  assert.deepEqual(result.mismatches, []);
});
