/**
 * Tests for previously-untested pure functions in headlessScorer.js:
 *   - classifySpeechAct: rule matching + neutral fallback + meme dampening
 *   - idfWeightedDensity / idfWeightedPerThousand / countWeightedMatches: IDF math
 *   - buildRuntimeLexicon / mergeDictionaryFamilies: lexicon construction + dedup
 *   - buildFilteredLexicon: high-frequency term filtering
 *
 * IDF tests use the real server/data/termFrequency.json (deterministic fixtures
 * picked from known entries). classifySpeechAct tests use rule-triggering and
 * neutral strings.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  classifySpeechAct,
  countWeightedMatches,
  idfWeightedDensity,
  idfWeightedPerThousand,
  buildRuntimeLexicon,
  mergeDictionaryFamilies,
  buildFilteredLexicon,
  baseLexicons,
  ZIEGENBEIN_CATEGORIES,
} from './headlessScorer.js';

// ---------------------------------------------------------------------------
// classifySpeechAct
// ---------------------------------------------------------------------------

describe('classifySpeechAct', () => {
  test('returns a neutral act when no rule matches', () => {
    const acts = classifySpeechAct('今天天气不错，出去散步了。', 0, 5);
    assert.ok(Array.isArray(acts));
    assert.equal(acts.length, 1);
    assert.equal(acts[0].neutral, true);
    assert.equal(acts[0].speechAct, '普通观点表达');
    assert.deepEqual(acts[0].deltas, {});
  });

  test('fires 人身攻击 rule for an attack keyword', () => {
    const acts = classifySpeechAct('你懂个屁啊', 2, 10);
    const attack = acts.find((a) => a.speechAct.includes('人身攻击'));
    assert.ok(attack, 'expected an attack speech act');
    assert.ok(attack.deltas.toxicEmotions > 0);
    assert.ok(attack.highlight.includes('你懂'));
    assert.equal(attack.severity, '高');
  });

  test('fires 甩举证责任 rule for an evasion keyword', () => {
    const acts = classifySpeechAct('你自己搜去，懒得跟你解释', 1, 8);
    const ev = acts.find((a) => a.speechAct === '甩举证责任');
    assert.ok(ev);
    assert.ok(ev.deltas.evidence < 0);
  });

  test('fires 留余地 (positive) rule for a cooperation keyword', () => {
    const acts = classifySpeechAct('我觉得可能还有一种情况', 0, 4);
    const coop = acts.find((a) => a.speechAct === '留余地 / 讲道理');
    assert.ok(coop);
    assert.equal(coop.positive, true);
    assert.ok(coop.deltas.cooperation > 0);
  });

  test('can fire multiple rules when multiple patterns match one comment', () => {
    // '你懂' triggers attack rule; '百度一下' triggers evasion rule.
    // (Note: '自己百度' alone is NOT in the evasion pattern — only 百度一下/去百度 are.)
    const acts = classifySpeechAct('你懂个啥，自己百度一下去', 0, 3);
    const actsNames = acts.map((a) => a.speechAct);
    assert.ok(actsNames.some((n) => n.includes('人身攻击')));
    assert.ok(actsNames.includes('甩举证责任'));
  });

  test('evidence field references the 1-based comment index out of total', () => {
    const acts = classifySpeechAct('你懂个啥', 3, 7);
    assert.ok(acts[0].evidence.includes('第 4/7 条评论'));
  });

  test('each non-neutral act has a unique id derived from index + act', () => {
    const acts = classifySpeechAct('你懂个啥，自己百度去', 5, 10);
    const ids = acts.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(id.startsWith('semantic-5-'));
  });

  test('neutral act id is semantic-neutral-{index}', () => {
    const acts = classifySpeechAct('无关文本若干字', 4, 9);
    assert.equal(acts[0].id, 'semantic-neutral-4');
  });
});

// ---------------------------------------------------------------------------
// IDF-weighted counting
// ---------------------------------------------------------------------------

describe('countWeightedMatches / idfWeightedDensity / idfWeightedPerThousand', () => {
  // Known termFrequency.json entries:
  //   没有  → userCount 72 (very common → low IDF: log(100/72) ≈ 0.3285)
  //   逆天  → userCount 5  (rare → high IDF: log(100/5) ≈ 2.9957)
  //   可能  → unknown    → IDF 1.0 (neutral)
  test('countWeightedMatches returns 0 for empty/missing terms', () => {
    assert.equal(countWeightedMatches('text', []), 0);
    assert.equal(countWeightedMatches('text', null), 0);
    assert.equal(countWeightedMatches('text', ['', null]), 0);
  });

  test('countWeightedMatches counts occurrences × IDF', () => {
    // '没有' appears twice; each weighted by IDF = log(100/72)
    const idf = Math.log(100 / 72);
    const result = countWeightedMatches('没有没有', ['没有']);
    assert.ok(Math.abs(result - 2 * idf) < 1e-9);
  });

  test('unknown term gets neutral weight 1.0', () => {
    // '可能' not in termFrequency → IDF 1.0 → 3 occurrences = 3.0
    const result = countWeightedMatches('可能可能可能', ['可能']);
    assert.ok(Math.abs(result - 3.0) < 1e-9);
  });

  test('idfWeightedDensity divides by total (floored at 1)', () => {
    const idf = Math.log(100 / 72);
    const density = idfWeightedDensity('没有', ['没有'], 10);
    assert.ok(Math.abs(density - idf / 10) < 1e-9);
  });

  test('idfWeightedDensity guards divide-by-zero (total=0 → /1)', () => {
    const idf = Math.log(100 / 72);
    const density = idfWeightedDensity('没有', ['没有'], 0);
    assert.ok(Math.abs(density - idf) < 1e-9);
  });

  test('idfWeightedPerThousand scales matches per 1000 chars', () => {
    const idf = Math.log(100 / 5); // 逆天
    const text = '逆天'; // length 2
    const result = idfWeightedPerThousand(text, ['逆天']);
    assert.ok(Math.abs(result - (idf / 2) * 1000) < 1e-9);
  });

  test('idfWeightedPerThousand guards empty text', () => {
    assert.equal(idfWeightedPerThousand('', ['逆天']), 0);
  });

  test('rare term contributes more per match than common term', () => {
    const rare = countWeightedMatches('逆天', ['逆天']);
    const common = countWeightedMatches('没有', ['没有']);
    assert.ok(rare > common, `rare ${rare} should outweigh common ${common}`);
  });
});

// ---------------------------------------------------------------------------
// Lexicon construction
// ---------------------------------------------------------------------------

describe('buildRuntimeLexicon', () => {
  test('returns a lexicon object keyed by baseLexicon families', () => {
    const lex = buildRuntimeLexicon();
    for (const family of Object.keys(baseLexicons)) {
      assert.ok(Array.isArray(lex[family]), `missing family ${family}`);
    }
  });

  test('merges custom terms on top of base and dedups', () => {
    // Use '脑子' (a base attack term not flagged for removal by the audit)
    // so the dedup assertion is stable regardless of audit downweight changes.
    const lex = buildRuntimeLexicon({ attack: ['脑子', 'CUSTOM_ATTACK_TERM_XYZ'] });
    assert.ok(lex.attack.includes('CUSTOM_ATTACK_TERM_XYZ'));
    // '脑子' appears once (deduped against the base lexicon)
    assert.equal(lex.attack.filter((t) => t === '脑子').length, 1);
  });

  test('handles empty customLexicon (returns base terms, possibly noise-filtered)', () => {
    const lex = buildRuntimeLexicon({});
    // filterNoiseTerms may drop audited 'remove' terms; compare as sets of the rest.
    const expected = new Set(baseLexicons.attack);
    for (const t of lex.attack) assert.ok(expected.has(t), `unexpected term ${t}`);
  });

  test('handles null/undefined customLexicon (default param)', () => {
    const lex = buildRuntimeLexicon();
    assert.ok(Array.isArray(lex.attack));
  });
});

describe('mergeDictionaryFamilies', () => {
  test('merges learned families into current lexicon and dedups', () => {
    // '脑子' is a stable base attack term (not audit-removed).
    const current = { attack: ['脑子'], cooperation: ['可能'] };
    const learned = { attack: ['脑子', 'NEW_ATTACK'], evidence: ['数据'] };
    const merged = mergeDictionaryFamilies(current, learned);
    assert.ok(merged.attack.includes('脑子'));
    assert.ok(merged.attack.includes('NEW_ATTACK'));
    assert.equal(merged.attack.filter((t) => t === '脑子').length, 1);
    // evidence family carried over from learned
    assert.ok(merged.evidence.includes('数据'));
  });

  test('missing families default to empty arrays', () => {
    const merged = mergeDictionaryFamilies({}, {});
    // all families in familyOrder are present as arrays
    for (const family of Object.keys(merged)) assert.ok(Array.isArray(merged[family]));
  });

  test('non-array learned family is treated as empty', () => {
    const merged = mergeDictionaryFamilies({ attack: ['脑子'] }, { attack: 'not-an-array' });
    assert.deepEqual(merged.attack, ['脑子']);
  });
});

describe('buildFilteredLexicon', () => {
  test('returns a new object, does not mutate input', () => {
    const input = { attack: ['你懂', '没有'] };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = buildFilteredLexicon(input);
    assert.deepEqual(input, snapshot); // unchanged
    assert.notEqual(out, input); // new ref
  });

  test('removes terms whose userFraction exceeds MAX_USER_FRACTION (default 0.30)', () => {
    // '没有' has userFraction 0.72 > 0.30 → filtered out
    const out = buildFilteredLexicon({ absolutes: ['没有', '全部'] });
    assert.ok(!out.absolutes.includes('没有'));
    assert.ok(out.absolutes.includes('全部')); // unknown term kept
  });

  test('handles null/undefined lexicon', () => {
    assert.deepEqual(buildFilteredLexicon(null), {});
    assert.deepEqual(buildFilteredLexicon(undefined), {});
  });
});

describe('ZIEGENBEIN_CATEGORIES constant', () => {
  test('has the four categories with key/label/shortLabel', () => {
    const keys = Object.keys(ZIEGENBEIN_CATEGORIES);
    assert.deepEqual(keys, ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons']);
    for (const cat of Object.values(ZIEGENBEIN_CATEGORIES)) {
      assert.ok(cat.key && cat.label && cat.shortLabel);
    }
  });
});
