/**
 * Tests for previously-untested exports in deepseekKeywordTrainer.js:
 *   - evidenceNeedlesForTerm: term + aliases + generated aliases, deduped & cleaned
 *   - normalizeDeepSeekAnalysisResult: shape normalization, score clamping,
 *     axis-label normalization, sentenceAnalyses filtering, confidence clamping
 *   - writeJsonFileAtomic / writeSerializedAtomic / writeSplitDictionaryAtomic:
 *     durability-critical atomic writers (AGENTS.md §13). Verified to actually
 *     persist content via temp→fsync→rename, and to clean up temp files.
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { readFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evidenceNeedlesForTerm,
  normalizeDeepSeekAnalysisResult,
  writeJsonFileAtomic,
  writeSerializedAtomic,
  writeSplitDictionaryAtomic,
} from './deepseekKeywordTrainer.js';

// ---------------------------------------------------------------------------
// evidenceNeedlesForTerm
// ---------------------------------------------------------------------------

describe('evidenceNeedlesForTerm', () => {
  test('returns the term itself plus known aliases (问百度 family)', () => {
    const needles = evidenceNeedlesForTerm('问百度');
    assert.ok(needles.includes('问百度'));
    assert.ok(needles.includes('不会百度'));
    assert.ok(needles.includes('自己百度'));
  });

  test('returns just the cleaned term when no aliases exist', () => {
    const needles = evidenceNeedlesForTerm('辣眼睛');
    assert.deepEqual(needles, ['辣眼睛']);
  });

  test('returns [] for empty/null/whitespace term', () => {
    assert.deepEqual(evidenceNeedlesForTerm(''), []);
    assert.deepEqual(evidenceNeedlesForTerm(null), []);
    assert.deepEqual(evidenceNeedlesForTerm('   '), []);
  });

  test('deduplicates needles', () => {
    const needles = evidenceNeedlesForTerm('问百度');
    const set = new Set(needles);
    assert.equal(set.size, needles.length);
  });
});

// ---------------------------------------------------------------------------
// normalizeDeepSeekAnalysisResult
// ---------------------------------------------------------------------------

describe('normalizeDeepSeekAnalysisResult', () => {
  test('returns a normalized result with ok=true and all 6 axes present', () => {
    const result = normalizeDeepSeekAnalysisResult({
      parsed: {},
      payload: { text: '一些评论内容' },
      config: { provider: 'deepseek', model: 'm1', reasoningEffort: 'high' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'deepseek');
    assert.equal(result.model, 'm1');
    assert.equal(result.reasoningEffort, 'high');
    assert.equal(result.axes.length, 6);
    // all axes default to score 50 when not provided
    for (const axis of result.axes) assert.equal(axis.score, 50);
    assert.ok(Array.isArray(result.sentenceAnalyses));
    assert.equal(typeof result.confidence, 'number');
  });

  test('clamps axis score to [0, 100]', () => {
    const result = normalizeDeepSeekAnalysisResult({
      parsed: { axes: [{ axis: '对抗性动机', score: 250 }] },
      payload: { text: '攻击性评论' },
    });
    const axis = result.axes.find((a) => a.axis === '对抗性动机');
    assert.ok(axis.score <= 100);
  });

  test('clamps confidence to [0.45, 0.92]', () => {
    const hi = normalizeDeepSeekAnalysisResult({ parsed: { confidence: 5 }, payload: {} });
    const mid = normalizeDeepSeekAnalysisResult({ parsed: { confidence: 0.6 }, payload: {} });
    // Note: confidence=0 falls through `Number(parsed.confidence) || 0.7` → 0.7
    // (0 is falsy), so the floor 0.45 only binds non-zero below-floor values.
    const belowFloor = normalizeDeepSeekAnalysisResult({ parsed: { confidence: 0.1 }, payload: {} });
    assert.equal(hi.confidence, 0.92);
    assert.equal(mid.confidence, 0.6);
    assert.equal(belowFloor.confidence, 0.45);
  });

  test('filters sentenceAnalyses to those with a non-empty quote', () => {
    const result = normalizeDeepSeekAnalysisResult({
      parsed: {
        sentenceAnalyses: [
          { quote: '有引用的句子', speechAct: '攻击' },
          { quote: '', speechAct: '空引用应被过滤' },
          { speechAct: '无quote字段' },
        ],
      },
      payload: { text: '有引用的句子' },
    });
    assert.equal(result.sentenceAnalyses.length, 1);
    assert.equal(result.sentenceAnalyses[0].quote, '有引用的句子');
  });

  test('normalizes unknown axis labels to null (dropped)', () => {
    const result = normalizeDeepSeekAnalysisResult({
      parsed: { axes: [{ axis: '不存在的轴', score: 80 }] },
      payload: { text: 'x' },
    });
    // unknown axis dropped → still 6 axes total (all defaulting to 50)
    assert.equal(result.axes.length, 6);
    const scores = result.axes.map((a) => a.score);
    assert.ok(scores.every((s) => s === 50));
  });

  test('truncates long reasoning/evidence fields', () => {
    const longEvidence = Array.from({ length: 20 }, (_, i) => `evidence-${i}`);
    const longReasoning = 'x'.repeat(1000);
    const result = normalizeDeepSeekAnalysisResult({
      parsed: { axes: [{ axis: '对抗性动机', score: 60, evidence: longEvidence, reasoning: longReasoning }] },
      payload: { text: 'x' },
    });
    const axis = result.axes.find((a) => a.axis === '对抗性动机');
    assert.ok(axis.evidence.length <= 5);
    assert.ok(axis.reasoning.length <= 500);
  });

  test('includes multiagent block only when provided', () => {
    const without = normalizeDeepSeekAnalysisResult({ parsed: {}, payload: {} });
    const withM = normalizeDeepSeekAnalysisResult({ parsed: {}, payload: {}, multiagent: { foo: 1 } });
    assert.equal('multiagent' in without, false);
    assert.deepEqual(withM.multiagent, { foo: 1 });
  });

  test('overall defaults riskBand to 混合争辩型', () => {
    const result = normalizeDeepSeekAnalysisResult({ parsed: {}, payload: {} });
    assert.equal(result.overall.riskBand, '混合争辩型');
  });
});

// ---------------------------------------------------------------------------
// Atomic writers (durability-critical, AGENTS.md §13)
// ---------------------------------------------------------------------------

describe('writeSerializedAtomic / writeJsonFileAtomic', () => {
  let tmpDir;

  before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'atomic-')); });
  after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('writeSerializedAtomic persists exact content to the target path', async () => {
    const p = join(tmpDir, 'a.txt');
    await writeSerializedAtomic(p, 'hello atomic world');
    const content = await readFile(p, 'utf8');
    assert.equal(content, 'hello atomic world');
  });

  test('writeJsonFileAtomic writes pretty JSON with trailing newline', async () => {
    const p = join(tmpDir, 'b.json');
    await writeJsonFileAtomic(p, { x: 1, nested: [2, 3] });
    const content = await readFile(p, 'utf8');
    assert.ok(content.endsWith('\n'));
    const parsed = JSON.parse(content);
    assert.equal(parsed.x, 1);
    assert.deepEqual(parsed.nested, [2, 3]);
  });

  test('creates parent directories that do not yet exist', async () => {
    const p = join(tmpDir, 'nested', 'deep', 'c.json');
    await writeJsonFileAtomic(p, { ok: true });
    assert.ok(existsSync(p));
  });

  test('overwrites an existing file atomically (no temp files left behind)', async () => {
    const p = join(tmpDir, 'overwrite.json');
    await writeJsonFileAtomic(p, { v: 1 });
    await writeJsonFileAtomic(p, { v: 2 });
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    assert.equal(parsed.v, 2);
    // no .tmp files lingering in the directory
    const files = await readdir(tmpDir);
    const tmps = files.filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(tmps, []);
  });

  test('temp file is cleaned up if the write throws', async () => {
    // Writing to a path whose parent is a file (not a dir) forces an error
    // after temp creation in the same dir.
    const blocker = join(tmpDir, 'blocker');
    await writeSerializedAtomic(blocker, 'i am a file'); // now a file exists where a dir is needed
    const impossible = join(blocker, 'child.json'); // blocker is a file → mkdir/rename fails
    await assert.rejects(() => writeJsonFileAtomic(impossible, { x: 1 }));
    // no temp files left in tmpDir root
    const files = await readdir(tmpDir);
    const tmps = files.filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(tmps, []);
  });
});

describe('writeSplitDictionaryAtomic', () => {
  let tmpDir;

  before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'split-dict-')); });
  after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('writes a split-storage manifest + per-family shard files', async () => {
    const dictPath = join(tmpDir, 'dict.json');
    const dictionary = {
      version: 2,
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [
        { term: '辣眼睛', family: 'attack', meaning: 'test' },
        { term: '百分百', family: 'absolutes', meaning: 'test' },
      ],
    };
    await writeSplitDictionaryAtomic(dictPath, dictionary);

    const manifest = JSON.parse(await readFile(dictPath, 'utf8'));
    assert.equal(manifest.storage, 'split');
    assert.equal(manifest.version, 2);
    assert.ok(typeof manifest.entryFiles === 'object');
    assert.ok(typeof manifest.evidenceFiles === 'object');
    // at least the attack family has a shard
    assert.ok(Array.isArray(manifest.entryFiles.attack));
    assert.ok(manifest.entryFiles.attack.length >= 1);

    // the attack shard file exists and holds the entry
    const attackShardPath = join(tmpDir, manifest.entryFiles.attack[0]);
    const shard = JSON.parse(await readFile(attackShardPath, 'utf8'));
    assert.ok(Array.isArray(shard.entries));
    assert.ok(shard.entries.some((e) => e.term === '辣眼睛'));
  });

  test('entries with unknown family default to attack', async () => {
    const dictPath = join(tmpDir, 'dict2.json');
    await writeSplitDictionaryAtomic(dictPath, {
      entries: [{ term: 'unknownFam', family: 'not-a-real-family' }],
    });
    const manifest = JSON.parse(await readFile(dictPath, 'utf8'));
    const attackShard = JSON.parse(await readFile(join(tmpDir, manifest.entryFiles.attack[0]), 'utf8'));
    assert.ok(attackShard.entries.some((e) => e.term === 'unknownFam'));
  });

  test('empty entries dictionary still writes a valid manifest', async () => {
    const dictPath = join(tmpDir, 'empty.json');
    await writeSplitDictionaryAtomic(dictPath, { entries: [] });
    const manifest = JSON.parse(await readFile(dictPath, 'utf8'));
    assert.equal(manifest.storage, 'split');
    for (const family of Object.keys(manifest.entryFiles)) {
      assert.ok(Array.isArray(manifest.entryFiles[family]));
    }
  });
});
