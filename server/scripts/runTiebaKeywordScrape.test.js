import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTiebaRuntimeCorpusUpdate } from './runTiebaKeywordScrape.js';

const RUN = {
  at: '2026-06-23T00:00:00.000Z',
  queries: ['tieba'],
  results: [{ comments: [{ message: 'new tieba comment', sourceUrl: 'https://tieba.baidu.com/p/1' }] }],
};

test('runTiebaKeywordScrape uses JS corpus update by default', async () => {
  const calls = [];
  const result = await buildTiebaRuntimeCorpusUpdate({
    corpus: { version: 1, comments: [], runs: [] },
    run: RUN,
    options: { usePythonCorpusUpdate: false },
    buildJsCorpusUpdate: (corpus, run) => {
      calls.push({ runner: 'js', comments: run.results[0].comments.length });
      return { changed: true, corpus: { ...corpus, comments: run.results[0].comments, runs: [run] }, newComments: run.results[0].comments };
    },
    runPythonCorpusUpdate: async () => {
      throw new Error('Python corpus update should not run by default');
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(calls, [{ runner: 'js', comments: 1 }]);
});

test('runTiebaKeywordScrape can opt into Python corpus update', async () => {
  const calls = [];
  const result = await buildTiebaRuntimeCorpusUpdate({
    corpus: { version: 1, comments: [], runs: [] },
    run: RUN,
    options: { usePythonCorpusUpdate: true },
    buildJsCorpusUpdate: () => {
      throw new Error('JS corpus update should not run when Python corpus update is enabled');
    },
    runPythonCorpusUpdate: async ({ corpus, run }) => {
      calls.push({ runner: 'python', comments: run.results[0].comments.length });
      return {
        ok: true,
        changed: true,
        corpus: { ...corpus, comments: run.results[0].comments, runs: [run] },
        newComments: run.results[0].comments,
      };
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.corpus.comments.map((comment) => comment.message), ['new tieba comment']);
  assert.deepEqual(calls, [{ runner: 'python', comments: 1 }]);
});
