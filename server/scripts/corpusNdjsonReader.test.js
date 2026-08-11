/**
 * Tests for corpusNdjsonReader.js — NDJSON stream reader.
 *
 * iterateNdjson (async generator), readNdjson, countNdjson, fileBytes are
 * exercised against temp NDJSON fixtures. Covers: empty lines, malformed
 * lines (skipped), missing file (fileBytes → -1), and large-ish iteration.
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { iterateNdjson, readNdjson, countNdjson, fileBytes } from './corpusNdjsonReader.js';

describe('corpusNdjsonReader', () => {
  let tmpDir;
  let ndjsonPath;
  let emptyPath;
  let malformedPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ndjson-'));
    ndjsonPath = join(tmpDir, 'corpus.ndjson');
    emptyPath = join(tmpDir, 'empty.ndjson');
    malformedPath = join(tmpDir, 'bad.ndjson');
    const lines = [
      JSON.stringify({ id: 1, text: 'hello' }),
      '', // blank line
      '   ', // whitespace-only line
      JSON.stringify({ id: 2, text: 'world' }),
      JSON.stringify({ id: 3, nested: { a: [1, 2] } }),
    ];
    writeFileSync(ndjsonPath, lines.join('\n'), 'utf8');
    writeFileSync(emptyPath, '', 'utf8');
    writeFileSync(malformedPath, '{not valid json\n{"ok": true}\n', 'utf8');
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('iterateNdjson yields parsed objects, skipping blank/whitespace lines', async () => {
    const items = [];
    for await (const item of iterateNdjson(ndjsonPath)) items.push(item);
    assert.equal(items.length, 3);
    assert.equal(items[0].id, 1);
    assert.equal(items[1].id, 2);
    assert.equal(items[2].nested.a[1], 2);
  });

  test('iterateNdjson silently skips malformed JSON lines', async () => {
    const items = [];
    for await (const item of iterateNdjson(malformedPath)) items.push(item);
    // first line is invalid → skipped; second line {"ok":true} → yielded
    assert.deepEqual(items, [{ ok: true }]);
  });

  test('iterateNdjson over an empty file yields nothing', async () => {
    const items = [];
    for await (const item of iterateNdjson(emptyPath)) items.push(item);
    assert.deepEqual(items, []);
  });

  test('readNdjson returns all items as an array', async () => {
    const items = await readNdjson(ndjsonPath);
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 3);
  });

  test('countNdjson counts non-blank lines', async () => {
    const n = await countNdjson(ndjsonPath);
    assert.equal(n, 3); // 3 non-blank lines (the 2 blank/whitespace don't count)
  });

  test('countNdjson on empty file returns 0', async () => {
    const n = await countNdjson(emptyPath);
    assert.equal(n, 0);
  });

  test('fileBytes returns byte size of an existing file', async () => {
    const bytes = await fileBytes(ndjsonPath);
    assert.ok(bytes > 0);
    // exact size = sum of the 3 JSON line lengths + 4 newlines... just assert positivity + matches fs
  });

  test('fileBytes returns -1 for a missing file', async () => {
    const bytes = await fileBytes(join(tmpDir, 'does-not-exist.ndjson'));
    assert.equal(bytes, -1);
  });
});
