/**
 * Tests for the PMI-based term co-occurrence analysis service.
 *
 * Tests the contract of analyzeRelationships() including:
 * - Empty/single-term edge cases
 * - Positive deltaPMI -> weight boost
 * - Negative deltaPMI -> weight suppression
 * - Pairs not in the model -> no adjustment
 * - Distance > 25 chars -> no relationship
 * - Multiple co-occurring pairs
 * - Weight adjustment formula correctness
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRelationships,
  clearModelCache,
  setModelForTesting,
  loadModel,
} from '../services/termCooccurrence.js';

// ---------------------------------------------------------------------------
// Mock model data
// ---------------------------------------------------------------------------

const MOCK_PAIRS = {
  '你根本::所有':  { highRiskPMI: 2.50, lowRiskPMI: -0.30, deltaPMI: 2.80, count: 5 },
  '脑子::从来':   { highRiskPMI: 1.80, lowRiskPMI: -0.50, deltaPMI: 2.30, count: 4 },
  '可能::确实':   { highRiskPMI: -1.20, lowRiskPMI: 2.10, deltaPMI: -3.30, count: 6 },
  '大概::有道理': { highRiskPMI: -0.80, lowRiskPMI: 1.50, deltaPMI: -2.30, count: 3 },
};

const MOCK_MODEL = {
  version: 1,
  builtAt: '2026-06-28T00:00:00.000Z',
  config: { windowSize: 25, minCooccurrences: 3, deltaThreshold: 0.3 },
  pairs: MOCK_PAIRS,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

function setupModel() {
  clearModelCache();
  setModelForTesting(MOCK_MODEL);
}

function teardownModel() {
  clearModelCache();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeRelationships', () => {
  test('returns empty result when matchedTerms is empty', () => {
    setupModel();
    const result = analyzeRelationships('some text', []);
    assert.deepEqual(result.relationships, []);
    assert.ok(result.adjustedWeights instanceof Map);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('returns empty result when matchedTerms is null', () => {
    setupModel();
    const result = analyzeRelationships('some text', null);
    assert.deepEqual(result.relationships, []);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('returns empty result when matchedTerms has only one term', () => {
    setupModel();
    const result = analyzeRelationships(
      '你根本不懂',
      [{ term: '你根本' }],
    );
    assert.deepEqual(result.relationships, []);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('returns empty result when commentText is empty', () => {
    setupModel();
    const result = analyzeRelationships('', [
      { term: '你根本' },
      { term: '所有' },
    ]);
    assert.deepEqual(result.relationships, []);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('boosts weights for positive deltaPMI pair (argumentative)', () => {
    setupModel();
    const text = '你根本不懂，所有这些都是错的';
    const terms = [
      { term: '你根本', weight: 1.0 },
      { term: '所有', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    // Should have 1 relationship (boost)
    assert.strictEqual(result.relationships.length, 1);
    assert.strictEqual(result.relationships[0].type, 'cooccurrence');
    assert.strictEqual(result.relationships[0].effect, 'boost');
    assert.ok(result.relationships[0].confidence > 0);

    // Both terms should have boosted weights (> 1.0)
    const weightA = result.adjustedWeights.get('你根本');
    const weightB = result.adjustedWeights.get('所有');
    assert.ok(weightA !== undefined, '你根本 should have adjusted weight');
    assert.ok(weightB !== undefined, '所有 should have adjusted weight');
    assert.ok(weightA > 1.0, `你根本 weight ${weightA} should be > 1.0`);
    assert.ok(weightB > 1.0, `所有 weight ${weightB} should be > 1.0`);

    // Both terms should have the same adjustment factor
    assert.strictEqual(weightA, weightB,
      'Both terms in a pair should get the same weight adjustment');

    teardownModel();
  });

  test('suppresses weights for negative deltaPMI pair (neutral)', () => {
    setupModel();
    const text = '可能确实是我的问题';
    const terms = [
      { term: '可能', weight: 1.0 },
      { term: '确实', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    assert.strictEqual(result.relationships.length, 1);
    assert.strictEqual(result.relationships[0].type, 'cooccurrence');
    assert.strictEqual(result.relationships[0].effect, 'suppress');

    // Both terms should have suppressed weights (< 1.0)
    const weightA = result.adjustedWeights.get('可能');
    const weightB = result.adjustedWeights.get('确实');
    assert.ok(weightA !== undefined);
    assert.ok(weightB !== undefined);
    assert.ok(weightA < 1.0, `可能 weight ${weightA} should be < 1.0`);
    assert.ok(weightB < 1.0, `确实 weight ${weightB} should be < 1.0`);

    teardownModel();
  });

  test('returns empty result when pair is not in the model', () => {
    setupModel();
    const text = 'unknown terms together';
    const terms = [
      { term: '未知词A', weight: 1.0 },
      { term: '未知词B', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    assert.strictEqual(result.relationships.length, 0);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('returns no relationship when terms are too far apart (>25 chars)', () => {
    setupModel();
    // 你根本 at position 0, 所有 at position ~28
    // Twenty-five filler chars between them
    const text = '你根本' + 'A'.repeat(26) + '所有都错了';
    const terms = [
      { term: '你根本', weight: 1.0 },
      { term: '所有', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    assert.strictEqual(result.relationships.length, 0,
      `Expected 0 relationships for terms >25 chars apart, got ${result.relationships.length}`);
    assert.strictEqual(result.adjustedWeights.size, 0);
    teardownModel();
  });

  test('handles multiple co-occurring pairs in one comment', () => {
    setupModel();
    // Contains both 你根本+所有 and 可能+确实
    const text = '你根本不懂，所有这些都是错的。但可能确实是这样的';
    const terms = [
      { term: '你根本', weight: 1.0 },
      { term: '所有', weight: 1.0 },
      { term: '可能', weight: 1.0 },
      { term: '确实', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    // Should have 2 relationships (one per known pair)
    assert.strictEqual(result.relationships.length, 2,
      `Expected 2 relationships, got ${result.relationships.length}`);

    // Check effects are opposite (one boost, one suppress)
    const effects = result.relationships.map(r => r.effect);
    assert.ok(effects.includes('boost'), 'Expected at least one boost');
    assert.ok(effects.includes('suppress'), 'Expected at least one suppress');

    // Check all 4 terms have adjusted weights
    assert.strictEqual(result.adjustedWeights.size, 4);

    teardownModel();
  });

  test('weight adjustment formula produces correct capped values', () => {
    setupModel();

    // For 你根本::所有:
    //   deltaPMI = 2.80, count = 5
    //   confidence = min(0.85, 5/5) = min(0.85, 1.0) = 0.85
    //   adjustment = 2.80 * 0.85 * 0.15 = 0.357
    //   capped at +-0.15 -> adjustment = 0.15
    //   newWeight = 1.0 * (1 + 0.15) = 1.15

    const text = '你根本不懂，所有这些都是错的';
    const terms = [
      { term: '你根本', weight: 1.0 },
      { term: '所有', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);
    const weight = result.adjustedWeights.get('你根本');

    // Weight should be exactly 1.15 (capped at +15%)
    assert.strictEqual(weight, 1.15,
      `Expected weight 1.15, got ${weight}`);

    teardownModel();
  });

  test('confidence is capped at 0.85', () => {
    setupModel();

    // Use a pair with high count to trigger the cap
    // For 可能::确实, count=6, confidence = min(0.85, 6/5) = min(0.85, 1.2) = 0.85
    const text = '可能确实是这样';
    const terms = [
      { term: '可能', weight: 1.0 },
      { term: '确实', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);
    assert.ok(result.relationships[0].confidence <= 0.85,
      `Confidence ${result.relationships[0].confidence} should be <= 0.85`);

    teardownModel();
  });

  test('loadModel returns empty pairs when no model file exists', () => {
    clearModelCache();
    const model = loadModel('/nonexistent/path.json');
    assert.deepEqual(model.pairs, {});
    clearModelCache();
  });

  test('setModelForTesting injects data correctly', () => {
    clearModelCache();
    const testData = {
      pairs: {
        'A::B': { highRiskPMI: 3.0, lowRiskPMI: 0.0, deltaPMI: 3.0, count: 5 },
      },
    };
    setModelForTesting(testData);
    const model = loadModel();
    assert.ok(model.pairs['A::B']);
    assert.strictEqual(model.pairs['A::B'].deltaPMI, 3.0);

    // Now actually test with this injected data
    const result = analyzeRelationships('A B', [
      { term: 'A', weight: 1.0 },
      { term: 'B', weight: 1.0 },
    ]);
    assert.strictEqual(result.relationships.length, 1);
    assert.strictEqual(result.relationships[0].effect, 'boost');

    clearModelCache();
  });

  test('only reports each unique pair once, not per occurrence', () => {
    setupModel();

    // 你根本 appears twice, 所有 appears once - should still be 1 relationship
    const text = '你根本不懂，所有都是你根本的错';
    const terms = [
      { term: '你根本', weight: 1.0 },
      { term: '所有', weight: 1.0 },
    ];

    const result = analyzeRelationships(text, terms);

    // Only 1 unique pair relationship, even though 你根本 appears twice
    assert.strictEqual(result.relationships.length, 1);

    teardownModel();
  });

  test('uses existing weight when term has pre-set weight', () => {
    setupModel();

    const text = '你根本不懂，所有这些都是错的';
    const terms = [
      { term: '你根本', weight: 0.5 },
      { term: '所有', weight: 2.0 },
    ];

    const result = analyzeRelationships(text, terms);

    // 你根本: 0.5 * (1 + 0.15) = 0.575
    // 所有: 2.0 * (1 + 0.15) = 2.30
    const weightA = result.adjustedWeights.get('你根本');
    const weightB = result.adjustedWeights.get('所有');

    assert.ok(weightA > 0.5, `你根本 weight ${weightA} should be > 0.5`);
    assert.ok(weightB > 2.0, `所有 weight ${weightB} should be > 2.0`);

    teardownModel();
  });
});
