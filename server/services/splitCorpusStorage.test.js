import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { readJsonCorpus, writeJsonCorpus } from './splitCorpusStorage.js';

test('writeJsonCorpus stores comments and runs in bounded shards and leaves a small manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'split-corpus-'));
  const corpusPath = join(dir, 'corpus.json');
  const comments = Array.from({ length: 12 }, (_item, index) => ({
    message: `评论 ${index} ${'内容'.repeat(20)}`,
    platform: 'bilibili',
    source: `https://www.bilibili.com/video/BV${index}/`,
    uid: String(index),
  }));
  const runs = Array.from({ length: 8 }, (_item, index) => ({
    at: `round-${index}`,
    actions: [{ term: `term-${index}`, query: 'query'.repeat(20) }],
    videos: [{ bvid: `BV${index}`, title: 'title'.repeat(30) }],
  }));

  await writeJsonCorpus(corpusPath, {
    version: 1,
    updatedAt: 'now',
    runs,
    comments,
  }, { maxShardBytes: 1024 });

  const manifest = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.equal(manifest.storage, 'split');
  assert.equal(manifest.commentCount, comments.length);
  assert.equal(manifest.runCount, runs.length);
  assert.equal(Array.isArray(manifest.comments), false);
  assert.equal(Array.isArray(manifest.runs), false);
  assert.equal(manifest.commentFiles.length > 1, true);
  assert.equal(manifest.runFiles.length > 1, true);

  const shardNames = await readdir(join(dir, 'corpus.comments'));
  assert.equal(shardNames.length, manifest.commentFiles.length);
  for (const relativePath of manifest.commentFiles) {
    const shardRaw = await readFile(join(dir, relativePath), 'utf8');
    assert.equal(Buffer.byteLength(shardRaw, 'utf8') <= manifest.shardMaxBytes, true);
  }
  const runShardNames = await readdir(join(dir, 'corpus.runs'));
  assert.equal(runShardNames.length, manifest.runFiles.length);
  for (const relativePath of manifest.runFiles) {
    const shardRaw = await readFile(join(dir, relativePath), 'utf8');
    assert.equal(Buffer.byteLength(shardRaw, 'utf8') <= manifest.shardMaxBytes, true);
  }

  const hydrated = await readJsonCorpus(corpusPath);
  assert.deepEqual(hydrated.comments, comments);
  assert.deepEqual(hydrated.runs, runs);
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

test('readJsonCorpus returns fallback when corpus file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'missing-corpus-'));
  const fallback = { version: 1, runs: [], comments: [] };

  assert.deepEqual(await readJsonCorpus(join(dir, 'missing.json'), fallback), fallback);
});

test('writeJsonCorpus round-trips empty comments and runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'empty-split-corpus-'));
  const corpusPath = join(dir, 'corpus.json');

  await writeJsonCorpus(corpusPath, {
    version: 1,
    updatedAt: 'empty',
    runs: [],
    comments: [],
  });

  const manifest = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.equal(manifest.commentCount, 0);
  assert.equal(manifest.runCount, 0);
  assert.equal(manifest.commentFiles.length, 1);
  assert.equal(manifest.runFiles.length, 1);

  const hydrated = await readJsonCorpus(corpusPath);
  assert.deepEqual(hydrated.comments, []);
  assert.deepEqual(hydrated.runs, []);
});
