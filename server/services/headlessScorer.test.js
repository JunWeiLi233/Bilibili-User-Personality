import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreComments, speechActRules, findLexiconMarks } from './headlessScorer.js';
import { stripBilibiliEmotes } from '../../src/languageUnderstanding.js';

/**
 * Speech-act rule deltas are keyed on the UI radar axes
 * (closure/logic/evidence/cooperation/correction) but the semantic
 * seeds in scoreComments only accept the 4 Ziegenbein categories.
 * Deltas that don't map are silently dropped — regression test for
 * the key-translation fix. Tests run in 'semantic' mode to isolate
 * the seed mapping from the learned blend weights.
 */

const scoreFor = (text, mode = 'semantic') =>
  scoreComments({ name: 'test', uid: 't1', text, analysisMode: mode });

test('speech-act deltas use mappable keys (all rules)', () => {
  const knownKeys = new Set([
    'toxicEmotions', 'closure', 'logic', 'evidence', 'cooperation', 'correction',
  ]);
  for (const rule of speechActRules) {
    for (const key of Object.keys(rule.deltas)) {
      assert.ok(knownKeys.has(key), `unknown delta key "${key}" in rule "${rule.act}"`);
    }
  }
});

test('conclusive assertion raises missingCommitment (closure delta mapped)', () => {
  // 一棍子打死 rule: closure +26, logic -20
  const r = scoreFor('从来就是这样，所有的策划都该滚');
  const axis = r.scores.find((s) => s.category === 'missingCommitment');
  // Baseline semantic seed is 28; closure +26 must raise it above the seed.
  assert.ok(axis.value > 28, `expected > 28, got ${axis.value}`);
});

test('burden-shifting raises missingIntelligibility (evidence delta mapped)', () => {
  // 甩举证责任 rule: evidence -28 → missingIntelligibility += 28
  const r = scoreFor('懂的都懂，懒得解释');
  const axis = r.scores.find((s) => s.category === 'missingIntelligibility');
  // Baseline semantic seed is 44; evidence delta must push it above 44.
  assert.ok(axis.value > 44, `expected > 44, got ${axis.value}`);
});

test('self-correction lowers missingCommitment (correction delta inverted)', () => {
  // 认错/改口 rule: correction +32 → missingCommitment -= 32 (capability measure)
  const r = scoreFor('我错了，你说得对，受教了');
  const axis = r.scores.find((s) => s.category === 'missingCommitment');
  assert.ok(axis.value < 28, `expected < 28, got ${axis.value}`);
});

// ---------------------------------------------------------------------------
// Bilibili emote handling — [xxx] emotes are not words and must not produce
// lexicon hits, even when the emote name exists in the dictionary.
// ---------------------------------------------------------------------------

const emojiLexicon = {
  attack: ['狗头', '滑稽'],
  cooperation: ['吃瓜', '打call'],
  evasion: ['哈哈'],
  absolutes: [],
  correction: [],
  evidence: [],
};

test('stripBilibiliEmotes removes [xxx] emotes but keeps surrounding text', () => {
  assert.equal(stripBilibiliEmotes('只要不乱动，总有人会漏腚[吃瓜]'), '只要不乱动，总有人会漏腚');
  assert.equal(stripBilibiliEmotes('[狗头][滑稽] 我支持'), '我支持');
  assert.equal(stripBilibiliEmotes('没有表情的评论'), '没有表情的评论');
});

test('[吃瓜] emoji does not produce a cooperation mark even if term is in lexicon', () => {
  const marks = findLexiconMarks('只要不乱动，总有人会漏腚[吃瓜]', 0, 1, emojiLexicon);
  assert.equal(marks.length, 0, `expected no marks, got ${marks.map((m) => m.family)}`);
});

test('[狗头] emoji does not produce an attack mark', () => {
  const marks = findLexiconMarks('这波操作我直接[狗头]', 0, 1, emojiLexicon);
  assert.equal(marks.length, 0);
});

test('plain-text term still matches after emote stripping', () => {
  const marks = findLexiconMarks('我为作者打call[吃瓜]', 0, 1, emojiLexicon);
  assert.ok(marks.some((m) => m.family === 'cooperation'), `expected cooperation mark, got ${marks.map((m) => m.family)}`);
});

test('density paths ignore emotes (scoreComments with emoji-only comment)', () => {
  // cooperation density lowers missingCommitment; a lone [打call] emoji must not.
  const emojiOnly = scoreComments({ name: 't', uid: 't2', text: '[打call][吃瓜][滑稽]', runtimeLexicon: emojiLexicon, analysisMode: 'lexicon' });
  const textWord = scoreComments({ name: 't', uid: 't3', text: '打call 支持一下', runtimeLexicon: emojiLexicon, analysisMode: 'lexicon' });
  const mcEmoji = emojiOnly.scores.find((s) => s.category === 'missingCommitment');
  const mcText = textWord.scores.find((s) => s.category === 'missingCommitment');
  assert.ok(mcEmoji.value >= mcText.value, `emoji-only should not lower missingCommitment: emoji ${mcEmoji.value} vs text ${mcText.value}`);
});
