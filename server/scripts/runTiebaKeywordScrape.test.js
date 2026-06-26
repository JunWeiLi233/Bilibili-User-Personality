import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildTiebaRuntimeCorpusUpdate } from './runTiebaKeywordScrape.js';

const RUN = {
  at: '2026-06-23T00:00:00.000Z',
  queries: ['tieba'],
  results: [{ comments: [{ message: 'new tieba comment', sourceUrl: 'https://tieba.baidu.com/p/1' }] }],
};

test('runTiebaKeywordScrape keeps explicit JS corpus update fallback', async () => {
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

test('runTiebaKeywordScrape uses Python corpus update when no fallback is requested', async () => {
  const calls = [];
  const result = await buildTiebaRuntimeCorpusUpdate({
    corpus: { version: 1, comments: [], runs: [] },
    run: RUN,
    options: {},
    buildJsCorpusUpdate: () => {
      throw new Error('JS corpus update should not run by default');
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

test('runTiebaKeywordScrape can delegate dry-run option planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'tieba-python-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          cwd: 'D:/tieba-python-plan-root',
          argv: ['--query=doge'],
          env: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = spawnSync('node', ['server/scripts/runTiebaKeywordScrape.js', '--plan-json', '--python-plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.ok(
      payload.options.actionFile.replace(/\\/g, '/').endsWith('tieba-python-plan-root/server/data/keywordCoverageActions.json'),
      `actionFile=${payload.options.actionFile}`,
    );
    assert.ok(
      payload.options.outputPath.replace(/\\/g, '/').endsWith('tieba-python-plan-root/server/data/tiebaKeywordCorpus.json'),
      `outputPath=${payload.options.outputPath}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runTiebaKeywordScrape can delegate scrape fixture execution to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'tieba-python-scrape-fixture-'));
  try {
    const payloadPath = join(tempDir, 'scrape-payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          keyword: 'provided',
          threads: [
            {
              id: '2222222222',
              kind: 'tieba-thread',
              title: 'Provided thread',
              keyword: 'provided',
              sourceUrl: 'https://tieba.baidu.com/p/2222222222',
            },
          ],
          threadHtmlById: {
            2222222222:
              '<div class="l_post" data-field=\'{"content":{"post_id":"12"},"author":{"user_name":"dave"}}\'><div class="d_post_content">provided thread comment</div></div>',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = spawnSync(
      'node',
      ['server/scripts/runTiebaKeywordScrape.js', '--scrape-fixture-json', '--python-scrape-fixture', '--payload', payloadPath],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.threads.map((thread) => thread.id), ['2222222222']);
    assert.deepEqual(payload.comments.map((comment) => comment.message), ['provided thread comment']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('compareTiebaKeywordPlan covers fixture keyword scrape parity', async () => {
  const { compareTiebaKeywordPlan } = await import('./compareTiebaKeywordPlan.js');

  const result = await compareTiebaKeywordPlan();

  assert.equal(result.ok, true);
  assert.equal(result.scrape.ok, true);
  assert.deepEqual(result.scrape.python.commentMessages, ['第一条贴吧评论', '第二条贴吧评论']);
  assert.deepEqual(result.scrape.python.threadIds, ['1234567890']);
});
