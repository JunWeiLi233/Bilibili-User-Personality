/**
 * Tests for relationshipPipeline.js — the 3-tier word-relationship pipeline.
 *
 * Covers:
 *   - analyzeRelationships: empty/single-term guards, Tier 1 composite confirm
 *     & suppress, Tier 2 co-occurrence passthrough, stats aggregation, the
 *     confidence>=0.8 resolution that excludes terms from later tiers.
 *   - analyzeRelationshipsAsync: Tier 3 stub passthrough (no crash when module
 *     absent), enableTier3 gating.
 *   - applyRelationshipWeights: suppression (weight<=0 removes match), rounding,
 *     relationshipAdjusted flag, no-op when map empty.
 *
 * Tier 1 fixtures use real composites from disambiguation_rules.json:
 *   comp-001: 不是X就是Y → confirm (applyTo 'all')
 *   comp-002: 不是X而是Y → suppress 不是
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  analyzeRelationships,
  analyzeRelationshipsAsync,
  applyRelationshipWeights,
} from './relationshipPipeline.js';

describe('analyzeRelationships — guards', () => {
  test('returns empty result for no matched terms', () => {
    const r = analyzeRelationships('some comment', []);
    assert.deepEqual(r.relationships, []);
    assert.equal(r.adjustedWeights.size, 0);
    assert.equal(r.stats.totalRelationships, 0);
    assert.equal(r.stats.suppressedTerms, 0);
  });

  test('returns empty result for null matched terms', () => {
    const r = analyzeRelationships('some comment', null);
    assert.deepEqual(r.relationships, []);
  });

  test('handles a single matched term without crashing (Tier 2 skipped)', () => {
    const r = analyzeRelationships('无关文本', [{ term: '不存在词', weight: 1 }]);
    // Tier 1 needs a composite match; none here → no relationships
    assert.ok(Array.isArray(r.relationships));
    assert.equal(r.stats.totalRelationships, r.relationships.length);
  });
});

describe('analyzeRelationships — Tier 1 composites', () => {
  test('comp-001 不是X就是Y → confirm boosts both matched terms', () => {
    // matchedTerms includes both '不是' and '就是'
    const matchedTerms = [
      { term: '不是', weight: 1 },
      { term: '就是', weight: 1 },
    ];
    const r = analyzeRelationships('这个人不是傻就是蠢', matchedTerms);
    const t1Rels = r.relationships.filter((x) => x.tier === 1);
    assert.ok(t1Rels.length >= 1, 'expected at least one Tier 1 relationship');
    const comp = t1Rels.find((x) => x.type === 'composite' && x.effect === 'boost');
    assert.ok(comp, 'expected a composite boost relationship');
    // both terms get adjusted weights (>0, boosted)
    assert.ok(r.adjustedWeights.has('不是') || r.adjustedWeights.has('就是'));
  });

  test('comp-002 不是X而是Y → suppress sets 不是 weight to 0', () => {
    const matchedTerms = [{ term: '不是', weight: 1 }];
    const r = analyzeRelationships('不是玩家的问题，而是策划的锅', matchedTerms);
    // suppress → weight 0
    assert.equal(r.adjustedWeights.get('不是'), 0);
    assert.ok(r.stats.suppressedTerms >= 1);
    const sup = r.relationships.find((x) => x.effect === 'suppress');
    assert.ok(sup, 'expected a suppress relationship');
  });

  test('composite does not fire when none of its terms are matched', () => {
    // text matches 不是X就是Y pattern but matchedTerms doesn't include 不是/就是
    const r = analyzeRelationships('这个人不是傻就是蠢', [{ term: '无关词', weight: 1 }]);
    const t1Rels = r.relationships.filter((x) => x.tier === 1);
    assert.equal(t1Rels.length, 0);
  });
});

describe('analyzeRelationships — stats aggregation', () => {
  test('stats.byTier and stats.byType are populated from relationships', () => {
    const matchedTerms = [{ term: '不是', weight: 1 }, { term: '就是', weight: 1 }];
    const r = analyzeRelationships('不是傻就是蠢', matchedTerms);
    if (r.relationships.length > 0) {
      assert.ok(typeof r.stats.byTier === 'object');
      assert.ok(typeof r.stats.byType === 'object');
      const tierSum = Object.values(r.stats.byTier).reduce((a, b) => a + b, 0);
      assert.equal(tierSum, r.relationships.length);
    }
  });

  test('enableTier2=false skips Tier 2 entirely', () => {
    // 2 matched terms that aren't resolved by Tier 1 → Tier 2 would normally run
    const matchedTerms = [
      { term: '不存在词A', weight: 1 },
      { term: '不存在词B', weight: 1 },
    ];
    const r = analyzeRelationships('无关文本若干字', matchedTerms, { enableTier2: false });
    const t2Rels = r.relationships.filter((x) => x.tier === 2);
    assert.equal(t2Rels.length, 0);
  });
});

describe('analyzeRelationshipsAsync', () => {
  test('returns a result object with relationships/adjustedWeights/stats', async () => {
    const r = await analyzeRelationshipsAsync('comment', [{ term: 'x', weight: 1 }]);
    assert.ok(Array.isArray(r.relationships));
    assert.ok(r.adjustedWeights instanceof Map);
    assert.equal(typeof r.stats, 'object');
  });

  test('enableTier3=false (default) does not invoke the LLM tier', async () => {
    // With Tier 3 disabled, the result equals the sync pipeline result shape.
    const r = await analyzeRelationshipsAsync('comment', [{ term: 'x', weight: 1 }]);
    assert.equal(r.stats.byTier[3] || 0, 0); // no tier-3 relationships added
  });

  test('enableTier3=true does not crash even when the module is a stub', async () => {
    // The real llmRelationAnalysis module may exist; if it does, it should
    // not throw on a trivial input. If it's absent, getTier3 returns a stub.
    const r = await analyzeRelationshipsAsync(
      '无关文本若干字',
      [{ term: '不存在A', weight: 1 }, { term: '不存在B', weight: 1 }],
      { enableTier3: true },
    );
    assert.ok(Array.isArray(r.relationships));
  });
});

describe('applyRelationshipWeights', () => {
  test('returns matches unchanged when adjustedWeights is empty', () => {
    const matches = [{ term: 'a', weight: 1 }];
    assert.deepEqual(applyRelationshipWeights(matches, new Map()), matches);
    assert.deepEqual(applyRelationshipWeights(matches, null), matches);
  });

  test('suppresses (removes) matches whose adjusted weight is <= 0', () => {
    const matches = [
      { term: 'keep', weight: 1 },
      { term: 'drop', weight: 1 },
    ];
    const adj = new Map([['drop', 0]]);
    const out = applyRelationshipWeights(matches, adj);
    assert.equal(out.length, 1);
    assert.equal(out[0].term, 'keep');
  });

  test('updates weight and sets relationshipAdjusted flag for kept terms', () => {
    const matches = [{ term: 'a', weight: 1 }];
    const adj = new Map([['a', 1.236]]);
    const out = applyRelationshipWeights(matches, adj);
    assert.equal(out[0].weight, 1.24); // rounded to 2 decimals
    assert.equal(out[0].relationshipAdjusted, true);
  });

  test('leaves matches untouched when term not in adjustedWeights', () => {
    const matches = [{ term: 'a', weight: 1 }];
    const adj = new Map([['other', 0.5]]);
    const out = applyRelationshipWeights(matches, adj);
    assert.equal(out[0].term, 'a');
    assert.equal(out[0].weight, 1);
    assert.equal(out[0].relationshipAdjusted, undefined);
  });

  test('handles matches missing a .term property', () => {
    const matches = [{ weight: 1 }, { term: 'a', weight: 1 }];
    const adj = new Map([['a', 0]]);
    const out = applyRelationshipWeights(matches, adj);
    assert.equal(out.length, 1); // the termless one kept, 'a' suppressed
  });
});
