/**
 * Tests for previously-untested exports in keywordHarvest.js:
 *   - selectExhaustedTerms: exhausted-term selection (zero-evidence default,
 *     attempt threshold, requireZeroEvidence toggle)
 *   - countAcceptedEvidenceHits: dedup of samples+sources per entry
 *   - countAcceptedEvidenceHitsForResult: term-scoped dedup across entries
 *     and dictionaryEvidenceEntries
 *
 * These complement keywordHarvest.test.js which covers the harvest loop.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  selectExhaustedTerms,
  countAcceptedEvidenceHits,
  countAcceptedEvidenceHitsForResult,
} from './keywordHarvest.js';

describe('selectExhaustedTerms', () => {
  test('default mode: only zero-evidence terms past the attempt threshold are exhausted', () => {
    const dictionary = {
      entries: [
        { term: 'zeroA', family: 'attack', evidenceCount: 0 },
        { term: 'zeroB', family: 'attack', evidenceCount: 0 },
        { term: 'partial', family: 'attack', evidenceCount: 1 }, // has evidence → skipped by default
        { term: 'full', family: 'attack', evidenceCount: 5 },    // >= target → skipped
      ],
    };
    const state = {
      termAttempts: {
        // base64url of 'zeroA' is emVyb0E; but termAttempts also accepts raw term key
        zeroA: { attempts: 12 },
        zeroB: { attempts: 5 }, // below default threshold 10
      },
    };
    const out = selectExhaustedTerms(dictionary, state, { targetEvidence: 3, attemptThreshold: 10 });
    assert.equal(out.length, 1);
    assert.equal(out[0].term, 'zeroA');
    assert.equal(out[0].attempts, 12);
    assert.equal(out[0].evidence, 0);
  });

  test('requireZeroEvidence=false also prunes partially-evidenced terms past threshold', () => {
    const dictionary = {
      entries: [
        { term: 'zero', family: 'attack', evidenceCount: 0 },
        { term: 'partial', family: 'attack', evidenceCount: 1 },
        { term: 'full', family: 'attack', evidenceCount: 3 },
      ],
    };
    const state = { termAttempts: { zero: { attempts: 11 }, partial: { attempts: 11 } } };
    const out = selectExhaustedTerms(dictionary, state, {
      targetEvidence: 3,
      attemptThreshold: 10,
      requireZeroEvidence: false,
    });
    const terms = out.map((x) => x.term).sort();
    assert.deepEqual(terms, ['partial', 'zero']);
  });

  test('terms already at/above targetEvidence are never exhausted', () => {
    const dictionary = { entries: [{ term: 'full', family: 'x', evidenceCount: 3 }] };
    const state = { termAttempts: { full: { attempts: 999 } } };
    const out = selectExhaustedTerms(dictionary, state, { targetEvidence: 3, attemptThreshold: 1 });
    assert.equal(out.length, 0);
  });

  test('returns [] for empty/missing dictionary entries', () => {
    assert.deepEqual(selectExhaustedTerms({}, { termAttempts: {} }), []);
    assert.deepEqual(selectExhaustedTerms({ entries: [] }, { termAttempts: {} }), []);
  });

  test('entry with no evidenceCount is treated as zero evidence (can be exhausted)', () => {
    // {term:'x'} has no evidenceCount → evidence 0; with attempts 99 ≥ default threshold 10 → exhausted
    const out = selectExhaustedTerms(
      { entries: [{ term: 'x' }] },
      { termAttempts: { x: { attempts: 99 } } },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].term, 'x');
    assert.equal(out[0].evidence, 0);
  });

  test('entries missing attempts are treated as 0 attempts (below threshold)', () => {
    const dictionary = { entries: [{ term: 'noAttempts', family: 'x', evidenceCount: 0 }] };
    const out = selectExhaustedTerms(dictionary, { termAttempts: {} }, { targetEvidence: 3, attemptThreshold: 10 });
    assert.equal(out.length, 0);
  });

  test('skips entries with no term', () => {
    const dictionary = { entries: [{ family: 'x', evidenceCount: 0 }, { term: '', evidenceCount: 0 }] };
    const state = { termAttempts: { '': { attempts: 99 } } };
    const out = selectExhaustedTerms(dictionary, state, { targetEvidence: 3, attemptThreshold: 1 });
    assert.equal(out.length, 0);
  });

  test('attempts under the threshold are not exhausted even with zero evidence', () => {
    const dictionary = { entries: [{ term: 'low', family: 'x', evidenceCount: 0 }] };
    const state = { termAttempts: { low: { attempts: 9 } } };
    const out = selectExhaustedTerms(dictionary, state, { targetEvidence: 3, attemptThreshold: 10 });
    assert.equal(out.length, 0);
  });
});

describe('countAcceptedEvidenceHits', () => {
  test('sums unique samples+sources per entry, falling back to evidenceCount', () => {
    const entries = [
      {
        term: 'a',
        evidenceSamples: ['sample one', 'sample two'],
        evidenceSources: [{ sample: 'sample one' }, { sample: 'source three' }], // 'sample one' dedups
        evidenceCount: 99,
      },
    ];
    // unique samples: 'sample one', 'sample two', 'source three' = 3 (evidenceCount ignored since samples exist)
    assert.equal(countAcceptedEvidenceHits(entries), 3);
  });

  test('falls back to evidenceCount when no samples/sources present', () => {
    const entries = [{ term: 'a', evidenceCount: 5 }];
    assert.equal(countAcceptedEvidenceHits(entries), 5);
  });

  test('treats empty/whitespace samples as absent', () => {
    const entries = [{ term: 'a', evidenceSamples: ['  ', ''], evidenceCount: 4 }];
    assert.equal(countAcceptedEvidenceHits(entries), 4);
  });

  test('returns 0 for empty input', () => {
    assert.equal(countAcceptedEvidenceHits([]), 0);
    assert.equal(countAcceptedEvidenceHits(null), 0);
  });
});

describe('countAcceptedEvidenceHitsForResult', () => {
  test('counts unique samples across entries + dictionaryEvidenceEntries, term-scoped', () => {
    const result = {
      entries: [
        { term: 'a', evidenceSamples: ['s1', 's2'] },
      ],
      keywordTraining: {
        dictionaryEvidenceEntries: [
          { term: 'a', evidenceSamples: ['s2', 's3'] }, // 's2' dedups with entry above for term 'a'
          { term: 'b', evidenceSources: [{ sample: 'sB' }] },
        ],
      },
    };
    // term a: s1, s2, s3 = 3 ; term b: sB = 1 → total 4
    assert.equal(countAcceptedEvidenceHitsForResult(result), 4);
  });

  test('falls back to evidenceCount only when a term has no samples', () => {
    const result = {
      entries: [{ term: 'a', evidenceCount: 7 }], // no samples → use evidenceCount
    };
    assert.equal(countAcceptedEvidenceHitsForResult(result), 7);
  });

  test('a term with samples overrides any fallback evidenceCount for that term', () => {
    const result = {
      entries: [
        { term: 'a', evidenceSamples: ['x'], evidenceCount: 9 }, // samples win → 1, evidenceCount ignored
        { term: 'b', evidenceCount: 4 }, // no samples → fallback 4
      ],
    };
    assert.equal(countAcceptedEvidenceHitsForResult(result), 5); // 1 + 4
  });

  test('returns 0 for empty/missing result', () => {
    assert.equal(countAcceptedEvidenceHitsForResult({}), 0);
    assert.equal(countAcceptedEvidenceHitsForResult(null), 0);
  });

  test('skips entries without a term', () => {
    const result = { entries: [{ evidenceSamples: ['x'] }, { term: '', evidenceCount: 5 }] };
    assert.equal(countAcceptedEvidenceHitsForResult(result), 0);
  });
});
