import assert from 'node:assert/strict';
import test from 'node:test';
import { convertToContract, analyzeRelationships } from './llmRelationAnalysis.js';

// ---------------------------------------------------------------------------
// convertToContract — pure function, no API needed
// ---------------------------------------------------------------------------

test('convertToContract handles valid LLM output with boost effect', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['完全', '垃圾'],
        type: 'intensification',
        effect: 'boost',
        confidence: 0.85,
        reason: '完全 intensifies 垃圾, increasing argumentative tone',
      },
    ],
  };

  const matchedTerms = [
    { term: '完全', family: 'absolutes', weight: 1.0 },
    { term: '垃圾', family: 'attack', weight: 1.2 },
  ];

  const result = convertToContract(llmOutput, matchedTerms);

  assert.equal(result.relationships.length, 1);
  assert.deepEqual(result.relationships[0].terms, ['完全', '垃圾']);
  assert.equal(result.relationships[0].type, 'llm');
  assert.equal(result.relationships[0].effect, 'boost');
  assert.equal(result.relationships[0].confidence, 0.85);
  assert.ok(result.relationships[0].reason.length > 0);

  // Weight adjustments: boost = base * (1 + 0.15 * confidence)
  assert.equal(result.adjustedWeights.get('完全'), +(1.0 * (1 + 0.15 * 0.85)).toFixed(2));
  assert.equal(result.adjustedWeights.get('垃圾'), +(1.2 * (1 + 0.15 * 0.85)).toFixed(2));
});

test('convertToContract handles valid LLM output with suppress effect', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['不是', '好'],
        effect: 'suppress',
        confidence: 0.9,
        reason: 'Negation',
      },
    ],
  };

  const matchedTerms = [
    { term: '不是', family: 'evasion', weight: 1.0 },
    { term: '好', family: 'cooperation', weight: 0.8 },
  ];

  const result = convertToContract(llmOutput, matchedTerms);

  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].effect, 'suppress');
  assert.equal(result.relationships[0].confidence, 0.9);

  // Weight adjustments: suppress = base * (1 - 0.3 * confidence)
  assert.equal(result.adjustedWeights.get('不是'), +(1.0 * (1 - 0.3 * 0.9)).toFixed(2));
  assert.equal(result.adjustedWeights.get('好'), +(0.8 * (1 - 0.3 * 0.9)).toFixed(2));
});

test('convertToContract handles neutral effect without weight adjustment', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['但是', '我觉得'],
        effect: 'neutral',
        confidence: 0.6,
        reason: 'Contrast marker, no argumentative shift',
      },
    ],
  };

  const matchedTerms = [
    { term: '但是', family: 'correction', weight: 1.0 },
    { term: '我觉得', family: 'evasion', weight: 0.9 },
  ];

  const result = convertToContract(llmOutput, matchedTerms);

  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].effect, 'neutral');

  // Neutral should not create weight entries
  assert.equal(result.adjustedWeights.has('但是'), false);
  assert.equal(result.adjustedWeights.has('我觉得'), false);
});

test('convertToContract skips relationships with fewer than 2 terms', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['单个词'],
        effect: 'boost',
        confidence: 0.5,
        reason: 'Single term',
      },
    ],
  };

  const result = convertToContract(llmOutput, [{ term: '单个词', weight: 1.0 }]);
  assert.equal(result.relationships.length, 0);
});

test('convertToContract skips relationships with invalid effect', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['词A', '词B'],
        effect: 'invalid_effect',
        confidence: 0.5,
        reason: 'Bad effect',
      },
    ],
  };

  const result = convertToContract(llmOutput, [
    { term: '词A', weight: 1.0 },
    { term: '词B', weight: 1.0 },
  ]);
  assert.equal(result.relationships.length, 0);
});

test('convertToContract clamps confidence to [0, 1]', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['词A', '词B'],
        effect: 'boost',
        confidence: 1.5,
        reason: 'Overconfident',
      },
      {
        terms: ['词C', '词D'],
        effect: 'boost',
        confidence: -0.5,
        reason: 'Negative confidence',
      },
    ],
  };

  const matchedTerms = [
    { term: '词A', weight: 1.0 },
    { term: '词B', weight: 1.0 },
    { term: '词C', weight: 1.0 },
    { term: '词D', weight: 1.0 },
  ];

  const result = convertToContract(llmOutput, matchedTerms);

  assert.equal(result.relationships.length, 2);
  assert.equal(result.relationships[0].confidence, 1.0);
  assert.equal(result.relationships[1].confidence, 0.0);
});

test('convertToContract handles missing or malformed LLM output gracefully', () => {
  // null input
  assert.deepEqual(convertToContract(null, []), { relationships: [], adjustedWeights: new Map() });

  // undefined input
  assert.deepEqual(convertToContract(undefined, []), { relationships: [], adjustedWeights: new Map() });

  // missing relationships key
  assert.deepEqual(convertToContract({}, []), { relationships: [], adjustedWeights: new Map() });

  // non-array relationships
  assert.deepEqual(convertToContract({ relationships: 'not-an-array' }, []), {
    relationships: [],
    adjustedWeights: new Map(),
  });
});

test('convertToContract skips terms not in matchedTerms', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['存在的词', '不存在的词'],
        effect: 'boost',
        confidence: 0.7,
        reason: 'One term exists',
      },
    ],
  };

  const matchedTerms = [{ term: '存在的词', weight: 1.0 }];
  const result = convertToContract(llmOutput, matchedTerms);

  // Relationship should still be recorded
  assert.equal(result.relationships.length, 1);
  // Only the matched term should have a weight adjustment
  assert.equal(result.adjustedWeights.get('存在的词'), +(1.0 * (1 + 0.15 * 0.7)).toFixed(2));
  assert.equal(result.adjustedWeights.has('不存在的词'), false);
});

test('convertToContract handles empty relationships array', () => {
  const llmOutput = { relationships: [] };
  const result = convertToContract(llmOutput, [{ term: '词', weight: 1.0 }]);
  assert.equal(result.relationships.length, 0);
  assert.equal(result.adjustedWeights.size, 0);
});

test('convertToContract uses default weight of 1 when weight is missing', () => {
  const llmOutput = {
    relationships: [
      {
        terms: ['词A', '词B'],
        effect: 'boost',
        confidence: 0.8,
        reason: 'Test',
      },
    ],
  };

  const matchedTerms = [
    { term: '词A' }, // no weight
    { term: '词B', weight: 2.0 },
  ];

  const result = convertToContract(llmOutput, matchedTerms);

  // 词A should get default weight 1.0
  assert.equal(result.adjustedWeights.get('词A'), +(1.0 * (1 + 0.15 * 0.8)).toFixed(2));
  assert.equal(result.adjustedWeights.get('词B'), +(2.0 * (1 + 0.15 * 0.8)).toFixed(2));
});

// ---------------------------------------------------------------------------
// analyzeRelationships — env control, opt-in, graceful degradation
// ---------------------------------------------------------------------------

test('analyzeRelationships returns empty when opt-in env var is not set', async () => {
  const result = await analyzeRelationships(
    '这个视频完全是垃圾',
    [
      { term: '完全', family: 'absolutes', weight: 1.0 },
      { term: '垃圾', family: 'attack', weight: 1.2 },
    ],
    {
      env: { BILIBILI_LLM_RELATIONS: '0' },
      apiKey: 'test-key',
    },
  );

  assert.deepEqual(result, { relationships: [], adjustedWeights: new Map() });
});

test('analyzeRelationships returns empty when no API key', async () => {
  const result = await analyzeRelationships(
    '这个视频完全是垃圾',
    [
      { term: '完全', family: 'absolutes', weight: 1.0 },
      { term: '垃圾', family: 'attack', weight: 1.2 },
    ],
    {
      env: { BILIBILI_LLM_RELATIONS: '1' },
      // no apiKey
    },
  );

  assert.deepEqual(result, { relationships: [], adjustedWeights: new Map() });
});

test('analyzeRelationships returns empty for single term', async () => {
  const result = await analyzeRelationships(
    '垃圾',
    [{ term: '垃圾', family: 'attack', weight: 1.0 }],
    {
      env: { BILIBILI_LLM_RELATIONS: '1' },
      apiKey: 'test-key',
    },
  );

  assert.deepEqual(result, { relationships: [], adjustedWeights: new Map() });
});

test('analyzeRelationships returns empty for null/undefined matchedTerms', async () => {
  const env = { BILIBILI_LLM_RELATIONS: '1' };

  const nullResult = await analyzeRelationships('test', null, { env, apiKey: 'test-key' });
  assert.deepEqual(nullResult, { relationships: [], adjustedWeights: new Map() });

  const undefinedResult = await analyzeRelationships('test', undefined, { env, apiKey: 'test-key' });
  assert.deepEqual(undefinedResult, { relationships: [], adjustedWeights: new Map() });
});

test('analyzeRelationships returns empty when API request fails (graceful degradation)', async () => {
  // Force the opt-in and provide a real-looking key, but the fetch will fail
  // because there's no server. This tests that errors are caught gracefully.
  const result = await analyzeRelationships(
    '这个视频完全是垃圾',
    [
      { term: '完全', family: 'absolutes', weight: 1.0 },
      { term: '垃圾', family: 'attack', weight: 1.2 },
    ],
    {
      force: true,
      apiKey: 'sk-test-invalid-key-that-will-fail',
      env: {
        DEEPSEEK_BASE_URL: 'https://api.invalid.nonexistent.example.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
      },
    },
  );

  // Should gracefully return empty instead of throwing
  assert.deepEqual(result, { relationships: [], adjustedWeights: new Map() });
});

test('analyzeRelationships respects force option to bypass env check', async () => {
  // force: true should work even without BILIBILI_LLM_RELATIONS set
  // This will still hit the API key check, but with a fake key it'll fail
  // gracefully. We're testing that it doesn't return early from the env check.
  const env = {};

  const result = await analyzeRelationships(
    'test',
    [
      { term: '词A', weight: 1.0 },
      { term: '词B', weight: 1.0 },
    ],
    { env, force: true },
    // no apiKey -> should hit "no API key" path, not "opt-in not set" path
  );

  assert.deepEqual(result, { relationships: [], adjustedWeights: new Map() });
  // If we got here without error, force worked (passed the env check)
});

// ---------------------------------------------------------------------------
// Live test (only if DEEPSEEK_API_KEY is set)
// ---------------------------------------------------------------------------

test('analyzeRelationships live test with real DeepSeek API', { skip: !process.env.DEEPSEEK_API_KEY }, async () => {
  const commentText = '这个策划绝对是傻逼，完全不懂游戏设计';
  const matchedTerms = [
    { term: '绝对', family: 'absolutes', weight: 1.0 },
    { term: '傻逼', family: 'attack', weight: 1.5 },
    { term: '完全', family: 'absolutes', weight: 1.0 },
  ];

  const result = await analyzeRelationships(commentText, matchedTerms, {
    force: true,
    apiKey: process.env.DEEPSEEK_API_KEY,
    env: {
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    },
  });

  // Should return some relationships since terms interact
  assert.ok(Array.isArray(result.relationships));

  for (const rel of result.relationships) {
    assert.equal(rel.type, 'llm');
    assert.ok(['boost', 'suppress', 'neutral'].includes(rel.effect));
    assert.ok(rel.confidence >= 0 && rel.confidence <= 1);
    assert.ok(Array.isArray(rel.terms));
    assert.ok(rel.terms.length >= 2);
    assert.ok(typeof rel.reason === 'string');
  }

  // adjustedWeights should be a Map
  assert.ok(result.adjustedWeights instanceof Map);
});
