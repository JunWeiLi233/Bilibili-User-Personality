import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORPUS_SHARD_WRITE_FIXTURES,
  compareCorpusShardWrite,
  compareCorpusShardWriteObjects,
} from './compareCorpusShardWrite.js';

test('compareCorpusShardWriteObjects reports matching write summaries', () => {
  const report = {
    ok: true,
    outputPath: 'ignored.json',
    manifest: {
      version: 2,
      storage: 'split',
      shardMaxBytes: 1024,
      commentFiles: ['out.comments/comments-0001.json'],
      commentCount: 1,
      runFiles: ['out.runs/runs-0001.json'],
      runCount: 1,
    },
    comments: 1,
    runs: 1,
  };

  assert.deepEqual(compareCorpusShardWriteObjects(report, report), {
    ok: true,
    mismatches: [],
    python: { manifest: report.manifest, comments: 1, runs: 1 },
    js: { manifest: report.manifest, comments: 1, runs: 1 },
  });
});

test('compareCorpusShardWrite compares JS and Python split corpus writes', async () => {
  const result = await compareCorpusShardWrite({
    payload: {
      maxShardBytes: 1024,
      manifest: { version: 7, updatedAt: '2026-06-19T00:00:00.000Z', source: 'bridge' },
      comments: [{ message: 'alpha'.repeat(80) }, { message: 'beta' }],
      runs: [{ at: 'round-1' }],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.python.comments, 2);
  assert.equal(result.python.runs, 1);
  assert.equal(result.python.manifest.storage, 'split');
});

test('compareCorpusShardWrite exports offline shard writer fixtures', async () => {
  assert.deepEqual(Object.keys(CORPUS_SHARD_WRITE_FIXTURES), [
    'split-comments-and-runs',
    'empty-corpus',
    'invalid-options',
  ]);

  const result = await compareCorpusShardWrite({
    fixtureNames: Object.keys(CORPUS_SHARD_WRITE_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('compareCorpusShardWrite real runners preserve offline shard writer contracts', async () => {
  const result = await compareCorpusShardWrite({
    fixtureNames: Object.keys(CORPUS_SHARD_WRITE_FIXTURES),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
