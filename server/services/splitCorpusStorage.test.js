import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { readJsonCorpus, writeJsonCorpus } from './splitCorpusStorage.js';

test('writeJsonCorpus stores comments in bounded shards and leaves a small manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'split-corpus-'));
  const corpusPath = join(dir, 'corpus.json');
  const comments = Array.from({ length: 12 }, (_item, index) => ({
    message: `评论 ${index} ${'内容'.repeat(20)}`,
    platform: 'bilibili',
    source: `https://www.bilibili.com/video/BV${index}/`,
    uid: String(index),
  }));

  await writeJsonCorpus(corpusPath, {
    version: 1,
    updatedAt: 'now',
    runs: [{ at: 'now', commentsAdded: comments.length }],
    comments,
  }, { maxShardBytes: 1024 });

  const manifest = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.equal(manifest.storage, 'split');
  assert.equal(manifest.commentCount, comments.length);
  assert.equal(Array.isArray(manifest.comments), false);
  assert.equal(manifest.commentFiles.length > 1, true);

  const shardNames = await readdir(join(dir, 'corpus.comments'));
  assert.equal(shardNames.length, manifest.commentFiles.length);
  for (const relativePath of manifest.commentFiles) {
    const shardRaw = await readFile(join(dir, relativePath), 'utf8');
    assert.equal(Buffer.byteLength(shardRaw, 'utf8') <= manifest.shardMaxBytes, true);
  }

  const hydrated = await readJsonCorpus(corpusPath);
  assert.deepEqual(hydrated.comments, comments);
  assert.deepEqual(hydrated.runs, [{ at: 'now', commentsAdded: comments.length }]);
});

test('readJsonCorpus preserves monolithic corpus files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mono-corpus-'));
  const corpusPath = join(dir, 'corpus.json');
  const raw = {
    version: 1,
    runs: [],
    comments: [{ message: '旧评论', source: 'old' }],
  };
  await writeFile(corpusPath, `${JSON.stringify(raw)}\n`, 'utf8');

  assert.deepEqual(await readJsonCorpus(corpusPath), raw);
});
