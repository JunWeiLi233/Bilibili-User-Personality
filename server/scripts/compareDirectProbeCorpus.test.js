import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIRECT_PROBE_CORPUS_FIXTURES, compareDirectProbeCorpus, DEFAULT_JS_REPORT } from './compareDirectProbeCorpus.js';

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

test('compareDirectProbeCorpus exports named corpus update fixtures', async () => {
  assert.deepEqual(Object.keys(DIRECT_PROBE_CORPUS_FIXTURES), [
    'dedupe-han-comment',
    'empty-existing-corpus',
    'multi-video-run',
  ]);

  const calls = [];
  const result = await compareDirectProbeCorpus({
    fixtureNames: Object.keys(DIRECT_PROBE_CORPUS_FIXTURES),
    runJs: async ({ payload, fixture }) => {
      calls.push({ js: fixture.name, comments: payload.comments.length });
      return fixture.expectedJsReport;
    },
    runPython: async ({ jsReport, fixture }) => {
      calls.push({ python: fixture.name, jsComments: jsReport.corpus.comments.length });
      return {
        ok: true,
        js: { commentMessages: jsReport.corpus.comments.map((comment) => comment.message) },
        python: { commentMessages: jsReport.corpus.comments.map((comment) => comment.message) },
        mismatches: [],
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'dedupe-han-comment', comments: 3 },
    { python: 'dedupe-han-comment', jsComments: 2 },
    { js: 'empty-existing-corpus', comments: 2 },
    { python: 'empty-existing-corpus', jsComments: 1 },
    { js: 'multi-video-run', comments: 3 },
    { python: 'multi-video-run', jsComments: 3 },
  ]);
});
