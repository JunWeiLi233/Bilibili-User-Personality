/**
 * Tests for the retained pure functions in semanticMatcher.js.
 *
 * The embedding functions are intentionally disabled stubs (Phase 5) and are
 * asserted here only to confirm their no-op contract, so a future re-enable
 * doesn't silently change the stub behavior. The real logic under test is
 * cosineSimilarity (numeric math) and chunkCommentText (sentence splitting).
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  cosineSimilarity,
  chunkCommentText,
  embedTexts,
  buildTermEmbeddings,
  matchCommentToTerms,
  findDictionaryEntriesWithSemanticEvidence,
  loadCachedEmbeddings,
} from './semanticMatcher.js';

describe('cosineSimilarity', () => {
  const round = (x) => Math.round(x * 1e9) / 1e9;

  test('identical vectors → 1', () => {
    assert.equal(round(cosineSimilarity([1, 2, 3], [1, 2, 3])), 1);
  });

  test('orthogonal vectors → 0', () => {
    assert.equal(round(cosineSimilarity([1, 0], [0, 1])), 0);
  });

  test('opposite vectors → -1', () => {
    assert.equal(round(cosineSimilarity([1, 1], [-1, -1])), -1);
  });

  test('partial similarity returns value in [-1, 1]', () => {
    const s = cosineSimilarity([1, 2, 3], [2, 3, 4]);
    assert.ok(s > 0 && s < 1);
    // dot=20, |a|=sqrt(14), |b|=sqrt(29) → 20/sqrt(406) ≈ 0.9925...
    assert.ok(Math.abs(s - 20 / Math.sqrt(14 * 29)) < 1e-9);
  });

  test('returns 0 when one vector is all zeros (denominator 0)', () => {
    assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
    assert.equal(cosineSimilarity([1, 2, 3], [0, 0, 0]), 0);
  });

  test('returns 0 when both vectors are empty', () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  test('uses the shorter length when vectors differ in size (extra tail ignored)', () => {
    // [1,0] vs [1,0,<extra>] → only first 2 dims used → cosine 1
    assert.equal(round(cosineSimilarity([1, 0], [1, 0, 99])), 1);
  });
});

describe('chunkCommentText', () => {
  test('splits on Chinese and ASCII sentence enders (segments ≥8 chars survive)', () => {
    const chunks = chunkCommentText('你好呀这是一段足够长的文字。另一个够长的分句内容！第三个分句也是够长的？换行后还有一段内容\n最后一句也要够长才行');
    // every surviving chunk is ≥ MIN_CHUNK_LENGTH
    for (const c of chunks) assert.ok(c.length >= 8, `chunk too short: ${c}`);
    assert.ok(chunks.length >= 4);
    assert.ok(chunks.some((c) => c.includes('你好呀')));
    assert.ok(chunks.some((c) => c.includes('另一个')));
    assert.ok(chunks.some((c) => c.includes('最后一句')));
  });

  test('splits on semicolons (full-width and half-width) — segments ≥8 chars survive', () => {
    // Each segment must independently be ≥ MIN_CHUNK_LENGTH (8) to survive.
    const long = chunkCommentText('第一部分的更多内容；第二部分的更多内容;第三部分的更多内容');
    assert.deepEqual(long, ['第一部分的更多内容', '第二部分的更多内容', '第三部分的更多内容']);
  });

  test('short segments are dropped; raw string returned as fallback when ≥8 chars', () => {
    // each segment < 8 chars → all filtered → raw (≥8) returned whole
    const chunks = chunkCommentText('第一部分；第二部分;第三部分');
    assert.deepEqual(chunks, ['第一部分；第二部分;第三部分']);
  });

  test('filters out chunks shorter than MIN_CHUNK_LENGTH (8 chars)', () => {
    const chunks = chunkCommentText('短。这是一个足够长的分句内容哦。');
    assert.deepEqual(chunks, ['这是一个足够长的分句内容哦']);
  });

  test('returns [] for empty / whitespace-only input', () => {
    assert.deepEqual(chunkCommentText(''), []);
    assert.deepEqual(chunkCommentText('   '), []);
    assert.deepEqual(chunkCommentText(null), []);
    assert.deepEqual(chunkCommentText(undefined), []);
  });

  test('returns the whole trimmed string as a single chunk when no delimiter and long enough', () => {
    const text = '这是一段没有任何标点符号但足够长的中文评论内容';
    assert.deepEqual(chunkCommentText(text), [text]);
  });

  test('returns [] when no delimiters and text shorter than MIN_CHUNK_LENGTH', () => {
    assert.deepEqual(chunkCommentText('短文本'), []);
  });
});

describe('disabled embedding stubs (Phase 5 contract)', () => {
  test('embedTexts resolves to empty array', async () => {
    assert.deepEqual(await embedTexts(['a', 'b']), []);
  });

  test('buildTermEmbeddings resolves to empty Map', async () => {
    const m = await buildTermEmbeddings({ entries: [] });
    assert.equal(m instanceof Map, true);
    assert.equal(m.size, 0);
  });

  test('matchCommentToTerms resolves to empty array', async () => {
    assert.deepEqual(await matchCommentToTerms(['x'], new Map(), 0.5), []);
  });

  test('findDictionaryEntriesWithSemanticEvidence resolves to empty array', async () => {
    assert.deepEqual(await findDictionaryEntriesWithSemanticEvidence({}, 'text'), []);
  });

  test('loadCachedEmbeddings resolves to null', async () => {
    assert.equal(await loadCachedEmbeddings(), null);
  });
});
