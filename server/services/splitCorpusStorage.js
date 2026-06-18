import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_SPLIT_CORPUS_MAX_SHARD_BYTES = 64 * 1024;

function jsonBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function commentsDirForCorpus(corpusPath) {
  return `${corpusPath.replace(/\.json$/i, '')}.comments`;
}

function commentsRelativePath(corpusPath, shardIndex) {
  const shardNumber = String(shardIndex + 1).padStart(4, '0');
  return `${commentsDirForCorpus(corpusPath).slice(dirname(corpusPath).length + 1).replace(/\\/g, '/')}/comments-${shardNumber}.json`;
}

function buildShardPayload(corpus, shard, shardCount, comments) {
  return {
    version: corpus.version || 1,
    updatedAt: corpus.updatedAt || null,
    shard,
    shardCount,
    comments,
  };
}

function splitCommentsBySerializedBytes(corpus, comments, maxShardBytes) {
  if (!comments.length) return [[]];
  const shards = [];
  let current = [];
  for (const comment of comments) {
    const candidate = [...current, comment];
    const payload = buildShardPayload(corpus, 9999, 9999, candidate);
    if (current.length > 0 && jsonBytes(payload) > maxShardBytes) {
      shards.push(current);
      current = [comment];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

async function removeStaleCommentShards(corpusPath, referencedFiles) {
  const commentsDir = commentsDirForCorpus(corpusPath);
  let names = [];
  try {
    names = await readdir(commentsDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return;
  }

  const referenced = new Set(referencedFiles.map((relativePath) => join(dirname(corpusPath), relativePath)));
  await Promise.all(
    names
      .map((name) => join(commentsDir, name))
      .filter((path) => /comments-\d{4}\.json$/i.test(path) && !referenced.has(path))
      .map((path) => rm(path, { force: true })),
  );
}

export async function readJsonCorpus(path, fallback = { version: 1, comments: [], runs: [] }) {
  try {
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (current?.storage !== 'split' || !Array.isArray(current.commentFiles)) return current;

    const comments = [];
    for (const relativePath of current.commentFiles) {
      const shardPath = join(dirname(path), String(relativePath));
      const shard = JSON.parse(await readFile(shardPath, 'utf8'));
      comments.push(...(Array.isArray(shard?.comments) ? shard.comments : []));
    }
    return {
      ...current,
      storage: 'split',
      comments,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonCorpus(path, corpus, options = {}) {
  const maxShardBytes = Math.max(1024, Number(options.maxShardBytes) || DEFAULT_SPLIT_CORPUS_MAX_SHARD_BYTES);
  const comments = Array.isArray(corpus?.comments) ? corpus.comments : [];
  const shards = splitCommentsBySerializedBytes(corpus || {}, comments, maxShardBytes);
  const commentFiles = [];

  for (let shardIndex = 0; shardIndex < shards.length; shardIndex += 1) {
    const relativePath = commentsRelativePath(path, shardIndex);
    commentFiles.push(relativePath);
    await writeJsonAtomic(
      join(dirname(path), relativePath),
      buildShardPayload(corpus || {}, shardIndex + 1, shards.length, shards[shardIndex]),
    );
  }

  const { comments: _comments, ...manifest } = corpus || {};
  await writeJsonAtomic(path, {
    ...manifest,
    version: manifest.version || 1,
    storage: 'split',
    shardMaxBytes: maxShardBytes,
    commentFiles,
    commentCount: comments.length,
  });
  await removeStaleCommentShards(path, commentFiles);
}
