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

function runsDirForCorpus(corpusPath) {
  return `${corpusPath.replace(/\.json$/i, '')}.runs`;
}

function commentsRelativePath(corpusPath, shardIndex) {
  const shardNumber = String(shardIndex + 1).padStart(4, '0');
  return `${commentsDirForCorpus(corpusPath).slice(dirname(corpusPath).length + 1).replace(/\\/g, '/')}/comments-${shardNumber}.json`;
}

function runsRelativePath(corpusPath, shardIndex) {
  const shardNumber = String(shardIndex + 1).padStart(4, '0');
  return `${runsDirForCorpus(corpusPath).slice(dirname(corpusPath).length + 1).replace(/\\/g, '/')}/runs-${shardNumber}.json`;
}

function buildShardPayload(corpus, shard, shardCount, key, values) {
  return {
    version: corpus.version || 1,
    updatedAt: corpus.updatedAt || null,
    shard,
    shardCount,
    [key]: values,
  };
}

function splitValuesBySerializedBytes(corpus, key, values, maxShardBytes) {
  if (!values.length) return [[]];
  const shards = [];
  let current = [];
  for (const value of values) {
    const candidate = [...current, value];
    const payload = buildShardPayload(corpus, 9999, 9999, key, candidate);
    if (current.length > 0 && jsonBytes(payload) > maxShardBytes) {
      shards.push(current);
      current = [value];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

async function removeStaleShards(corpusPath, shardDir, referencedFiles, pattern) {
  let names = [];
  try {
    names = await readdir(shardDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return;
  }

  const referenced = new Set(referencedFiles.map((relativePath) => join(dirname(corpusPath), relativePath)));
  await Promise.all(
    names
      .map((name) => join(shardDir, name))
      .filter((path) => pattern.test(path) && !referenced.has(path))
      .map((path) => rm(path, { force: true })),
  );
}

async function hydrateShardFiles(path, files, key) {
  const values = [];
  for (const relativePath of files) {
    const shardPath = join(dirname(path), String(relativePath));
    const shard = JSON.parse(await readFile(shardPath, 'utf8'));
    values.push(...(Array.isArray(shard?.[key]) ? shard[key] : []));
  }
  return values;
}

async function writeShardFiles(path, corpus, key, relativePathForIndex, maxShardBytes) {
  const values = Array.isArray(corpus?.[key]) ? corpus[key] : [];
  const shards = splitValuesBySerializedBytes(corpus || {}, key, values, maxShardBytes);
  const files = [];

  for (let shardIndex = 0; shardIndex < shards.length; shardIndex += 1) {
    const relativePath = relativePathForIndex(path, shardIndex);
    files.push(relativePath);
    await writeJsonAtomic(
      join(dirname(path), relativePath),
      buildShardPayload(corpus || {}, shardIndex + 1, shards.length, key, shards[shardIndex]),
    );
  }

  return { files, count: values.length };
}

export async function readJsonCorpus(path, fallback = { version: 1, comments: [], runs: [] }) {
  try {
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (current?.storage !== 'split') return current;

    const comments = Array.isArray(current.commentFiles)
      ? await hydrateShardFiles(path, current.commentFiles, 'comments')
      : (Array.isArray(current.comments) ? current.comments : []);
    const runs = Array.isArray(current.runFiles)
      ? await hydrateShardFiles(path, current.runFiles, 'runs')
      : (Array.isArray(current.runs) ? current.runs : []);
    return {
      ...current,
      storage: 'split',
      comments,
      runs,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonCorpus(path, corpus, options = {}) {
  const maxShardBytes = Math.max(1024, Number(options.maxShardBytes) || DEFAULT_SPLIT_CORPUS_MAX_SHARD_BYTES);
  const comments = await writeShardFiles(path, corpus, 'comments', commentsRelativePath, maxShardBytes);
  const runs = await writeShardFiles(path, corpus, 'runs', runsRelativePath, maxShardBytes);

  const { comments: _comments, runs: _runs, ...manifest } = corpus || {};
  await writeJsonAtomic(path, {
    ...manifest,
    version: manifest.version || 1,
    storage: 'split',
    shardMaxBytes: maxShardBytes,
    commentFiles: comments.files,
    commentCount: comments.count,
    runFiles: runs.files,
    runCount: runs.count,
  });
  await removeStaleShards(path, commentsDirForCorpus(path), comments.files, /comments-\d{4}\.json$/i);
  await removeStaleShards(path, runsDirForCorpus(path), runs.files, /runs-\d{4}\.json$/i);
}
