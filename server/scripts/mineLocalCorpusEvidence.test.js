/**
 * Tests for the pure helpers exported by mineLocalCorpusEvidence.js:
 *   - parseCorpusPaths: multi-delimiter path splitting
 *   - parseArgs: argv + env option resolution + clamping
 *   - targetTermsFromActions: dedup + term extraction from action objects
 *   - readJson: .txt vs JSON vs split-storage dispatch
 *
 * readJson is tested with temp files; runLocalCorpusEvidenceMining is an
 * orchestration entrypoint and is covered integration-style elsewhere.
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseCorpusPaths,
  parseArgs,
  targetTermsFromActions,
  readJson,
} from './mineLocalCorpusEvidence.js';

describe('parseCorpusPaths', () => {
  test('splits on commas, semicolons, pipes, and newlines', () => {
    assert.deepEqual(parseCorpusPaths('a.json,b.json;c.json|d.json\ne.json'), [
      'a.json', 'b.json', 'c.json', 'd.json', 'e.json',
    ]);
  });

  test('trims whitespace around each item', () => {
    assert.deepEqual(parseCorpusPaths('  a.json  ,  b.json '), ['a.json', 'b.json']);
  });

  test('drops empty items', () => {
    assert.deepEqual(parseCorpusPaths('a.json,,b.json,'), ['a.json', 'b.json']);
  });

  test('returns [] for null/undefined/empty', () => {
    assert.deepEqual(parseCorpusPaths(null), []);
    assert.deepEqual(parseCorpusPaths(undefined), []);
    assert.deepEqual(parseCorpusPaths(''), []);
  });
});

describe('parseArgs', () => {
  test('uses defaults from env when no argv', () => {
    const opts = parseArgs([], {});
    // DEFAULT_CORPUS_PATHS is the fallback when env has none
    assert.ok(Array.isArray(opts.corpusPaths));
    assert.ok(opts.corpusPaths.length > 0);
    assert.equal(opts.targetEvidence, 3);
    assert.equal(opts.maxSamplesPerTerm, 3);
    assert.equal(opts.requireCommentBackedEvidence, true);
    assert.equal(opts.write, false);
  });

  test('reads corpus paths from env', () => {
    const opts = parseArgs([], { LOCAL_BILIBILI_CORPUS_PATH: 'x.json,y.json' });
    assert.deepEqual(opts.corpusPaths, ['x.json', 'y.json']);
  });

  test('--corpus= overrides env corpus paths', () => {
    const opts = parseArgs(['--corpus=z.json'], { LOCAL_BILIBILI_CORPUS_PATH: 'x.json' });
    assert.deepEqual(opts.corpusPaths, ['z.json']);
  });

  test('--target-evidence= and --max-samples-per-term= are parsed', () => {
    const opts = parseArgs(['--target-evidence=5', '--max-samples-per-term=7'], {});
    assert.equal(opts.targetEvidence, 5);
    assert.equal(opts.maxSamplesPerTerm, 7);
  });

  test('targetEvidence clamps to [1, 20]', () => {
    assert.equal(parseArgs(['--target-evidence=0'], {}).targetEvidence, 1);
    assert.equal(parseArgs(['--target-evidence=999'], {}).targetEvidence, 20);
    assert.equal(parseArgs(['--target-evidence=abc'], {}).targetEvidence, 3); // NaN→fallback 3
  });

  test('maxSamplesPerTerm clamps to [1, 20]', () => {
    assert.equal(parseArgs(['--max-samples-per-term=0'], {}).maxSamplesPerTerm, 1);
    assert.equal(parseArgs(['--max-samples-per-term=100'], {}).maxSamplesPerTerm, 20);
  });

  test('--no-comment-backed sets requireCommentBackedEvidence=false', () => {
    assert.equal(parseArgs(['--no-comment-backed'], {}).requireCommentBackedEvidence, false);
  });

  test('--write sets write=true (and env LOCAL_CORPUS_WRITE=1 also)', () => {
    assert.equal(parseArgs(['--write'], {}).write, true);
    assert.equal(parseArgs([], { LOCAL_CORPUS_WRITE: '1' }).write, true);
    assert.equal(parseArgs([], { LOCAL_CORPUS_WRITE: '0' }).write, false);
  });

  test('--actions= overrides actionFile', () => {
    assert.equal(parseArgs(['--actions=/tmp/actions.json'], {}).actionFile, '/tmp/actions.json');
  });

  test('targetEvidence env var override', () => {
    assert.equal(parseArgs([], { BILIBILI_COVERAGE_TARGET_EVIDENCE: '8' }).targetEvidence, 8);
  });
});

describe('targetTermsFromActions', () => {
  test('extracts and dedups .term from action objects', () => {
    const actions = [
      { term: '辣眼睛' },
      { term: '辣眼睛' },
      { term: '网盘见' },
      { term: '  网盘见  ' }, // trimmed, deduped
      { family: 'attack' }, // no term → skipped
      null,
      undefined,
      { term: '' },
    ];
    assert.deepEqual(targetTermsFromActions(actions), ['辣眼睛', '网盘见']);
  });

  test('returns [] for non-array input', () => {
    assert.deepEqual(targetTermsFromActions(undefined), []);
    assert.deepEqual(targetTermsFromActions(null), []);
    assert.deepEqual(targetTermsFromActions('not-array'), []);
  });

  test('returns [] for empty array', () => {
    assert.deepEqual(targetTermsFromActions([]), []);
  });
});

describe('readJson', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mine-'));
    mkdirSync(join(tmpDir, 'shards'), { recursive: true });
  });
  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('reads a .txt file into an array of lines', async () => {
    const p = join(tmpDir, 'q.txt');
    writeFileSync(p, 'term1\nterm2\nterm3', 'utf8');
    const out = await readJson(p);
    assert.deepEqual(out, ['term1', 'term2', 'term3']);
  });

  test('reads a plain JSON object file', async () => {
    const p = join(tmpDir, 'obj.json');
    writeFileSync(p, JSON.stringify({ a: 1, b: [2, 3] }), 'utf8');
    const out = await readJson(p);
    assert.equal(out.a, 1);
    assert.deepEqual(out.b, [2, 3]);
  });

  test('reads a JSON array file', async () => {
    const p = join(tmpDir, 'arr.json');
    writeFileSync(p, JSON.stringify([{ x: 1 }]), 'utf8');
    const out = await readJson(p);
    assert.deepEqual(out, [{ x: 1 }]);
  });

  test('dispatches split-storage corpora to readJsonCorpus', async () => {
    // split-storage manifest detection: { storage: 'split', commentFiles: [...] }
    // A manifest referencing a MISSING shard collapses to readJsonCorpus's blank
    // fallback { version:1, comments:[], runs:[] } (ENOENT from the missing shard
    // propagates to the outer catch). Pin this contract.
    const p = join(tmpDir, 'split.json');
    writeFileSync(p, JSON.stringify({
      storage: 'split',
      commentFiles: ['nonexistent-shard.json'],
      meta: { n: 0 },
    }), 'utf8');
    const out = await readJson(p);
    assert.equal(typeof out, 'object');
    assert.ok(Array.isArray(out.comments));
    // blank fallback shape when shards are missing
    assert.deepEqual(out.comments, []);
    assert.deepEqual(out.runs, []);
  });

  test('readJsonCorpus path hydrates real shards into a comments array', async () => {
    // Shards are JSON OBJECTS (not NDJSON) each carrying a `comments` array —
    // hydrateShardFiles does JSON.parse then reads shard.comments.
    const manifestPath = join(tmpDir, 'split2.json');
    const shardPath = join(tmpDir, 'shards', 'c-001.json');
    writeFileSync(shardPath, JSON.stringify({
      shardIndex: 1,
      shardCount: 1,
      comments: [{ message: 'hi' }, { message: 'yo' }],
    }), 'utf8');
    writeFileSync(manifestPath, JSON.stringify({
      storage: 'split',
      commentFiles: ['shards/c-001.json'],
      version: 2,
    }), 'utf8');
    const out = await readJson(manifestPath);
    assert.equal(out.storage, 'split');
    assert.ok(Array.isArray(out.comments));
    assert.equal(out.comments.length, 2);
    assert.equal(out.comments[0].message, 'hi');
  });
});
