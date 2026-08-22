#!/usr/bin/env node

/**
 * corpusNdjsonReader.js — Stream reader for NDJSON corpus files
 *
 * Lets consumer scripts iterate items without loading the entire corpus
 * into memory.  Usage:
 *
 *   import { iterateNdjson } from './corpusNdjsonReader.js';
 *   for await (const item of iterateNdjson('server/data/bulkCorpus.ndjson')) {
 *     // item is a parsed JSON object
 *   }
 *
 *   // Or get all as array (only for reasonably sized files):
 *   import { readNdjson } from './corpusNdjsonReader.js';
 *   const items = await readNdjson('server/data/bulkCorpus.ndjson');
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';

/**
 * Async generator — yields each parsed JSON object from an NDJSON file.
 * Memory usage is constant regardless of file size.
 */
export async function* iterateNdjson(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      yield JSON.parse(t);
    } catch {
      // skip malformed lines
    }
  }
}

/**
 * Returns all items as an array.  Use only for files that are small enough
 * to fit in memory — for large files prefer iterateNdjson().
 */
export async function readNdjson(filePath) {
  const items = [];
  for await (const item of iterateNdjson(filePath)) {
    items.push(item);
  }
  return items;
}

/**
 * Quick count of items (lines) in an NDJSON file.
 */
export async function countNdjson(filePath) {
  let count = 0;
  const rl = createInterface({
    input: createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) count++;
    if (count % 500000 === 0) console.log(`[count] ${count.toLocaleString()}...`);
  }
  return count;
}

/**
 * Quick size in bytes. Returns -1 if file doesn't exist.
 */
export async function fileBytes(filePath) {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return -1;
  }
}
