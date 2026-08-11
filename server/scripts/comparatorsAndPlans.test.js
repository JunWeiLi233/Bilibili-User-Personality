/**
 * Tests for previously-untested pure functions in server/scripts:
 *   - compareCoverageHarvestLoopCommand.compareCoverageHarvestLoopCommandObjects:
 *     the pure JS/Python report comparator (the async wrapper is already
 *     exercised end-to-end; the pure comparator is not).
 *   - resolveNearTargetTerms.buildResolveNearTargetPlan: near-target resolver
 *     plan builder (candidate selection, bvid extraction, batching, skip reason).
 *
 * Both are pure (no subprocess / network), so they unit-test cleanly.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { compareCoverageHarvestLoopCommandObjects } from './compareCoverageHarvestLoopCommand.js';
import { buildResolveNearTargetPlan } from './resolveNearTargetTerms.js';

// ---------------------------------------------------------------------------
// compareCoverageHarvestLoopCommandObjects
// ---------------------------------------------------------------------------

describe('compareCoverageHarvestLoopCommandObjects', () => {
  test('ok=true when summary keys all match', () => {
    const report = {
      maxCycles: 1,
      roundsPerCycle: 2,
      stopReason: 'coverage_gate_passed',
      finalOk: true,
      cycles: [{}, {}],
      finalAudit: {
        coverage: { terms: 10, weakTerms: 2, zeroEvidenceTerms: 1 },
        recommendedQueries: ['q1', 'q2'],
      },
    };
    const r = compareCoverageHarvestLoopCommandObjects(report, report);
    assert.equal(r.ok, true);
    assert.deepEqual(r.mismatches, []);
  });

  test('reports a mismatch when weakTerms differ', () => {
    const py = { finalAudit: { coverage: { terms: 10, weakTerms: 2 } } };
    const js = { finalAudit: { coverage: { terms: 10, weakTerms: 3 } } };
    const r = compareCoverageHarvestLoopCommandObjects(py, js);
    assert.equal(r.ok, false);
    const m = r.mismatches.find((x) => x.key === 'weakTerms');
    assert.ok(m);
    assert.equal(m.python, 2);
    assert.equal(m.js, 3);
  });

  test('reports a mismatch when stopReason differs', () => {
    const r = compareCoverageHarvestLoopCommandObjects(
      { stopReason: 'coverage_gate_passed' },
      { stopReason: 'max_cycles' },
    );
    assert.equal(r.ok, false);
    assert.ok(r.mismatches.some((x) => x.key === 'stopReason'));
  });

  test('reports a mismatch when recommendedQueries differ (order-sensitive)', () => {
    const r = compareCoverageHarvestLoopCommandObjects(
      { finalAudit: { recommendedQueries: ['a', 'b'] } },
      { finalAudit: { recommendedQueries: ['b', 'a'] } },
    );
    assert.equal(r.ok, false);
    assert.ok(r.mismatches.some((x) => x.key === 'recommendedQueries'));
  });

  test('finalOk mismatch when one is true and other is not exactly true', () => {
    const r = compareCoverageHarvestLoopCommandObjects({ finalOk: true }, { finalOk: 1 });
    assert.equal(r.ok, false);
    assert.ok(r.mismatches.some((x) => x.key === 'finalOk'));
  });

  test('returns both summarized objects for inspection', () => {
    const r = compareCoverageHarvestLoopCommandObjects(
      { maxCycles: 5 },
      { maxCycles: 5 },
    );
    assert.equal(r.python.maxCycles, 5);
    assert.equal(r.js.maxCycles, 5);
    // default values for missing fields
    assert.equal(r.python.stopReason, '');
    assert.equal(r.python.finalOk, false);
    assert.deepEqual(r.python.recommendedQueries, []);
  });

  test('handles empty inputs (both empty → ok, all defaults)', () => {
    const r = compareCoverageHarvestLoopCommandObjects({}, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.mismatches, []);
  });

  test('cyclesLength counts array length, 0 for non-array', () => {
    const r = compareCoverageHarvestLoopCommandObjects(
      { cycles: [1, 2, 3] },
      { cycles: 'not-array' },
    );
    assert.equal(r.ok, false);
    const m = r.mismatches.find((x) => x.key === 'cyclesLength');
    assert.equal(m.python, 3);
    assert.equal(m.js, 0);
  });
});

// ---------------------------------------------------------------------------
// buildResolveNearTargetPlan
// ---------------------------------------------------------------------------

describe('buildResolveNearTargetPlan', () => {
  // helper: build a dictionary with entries whose evidenceSources embed BVIDs
  function dictWith(entries) {
    return { version: 1, entries };
  }

  test('selects override terms that exist in the dictionary and extracts their source bvids', () => {
    const dict = dictWith([
      {
        term: '辣眼睛',
        family: 'attack',
        evidenceCount: 2,
        evidenceSources: [
          { sample: 'see https://www.bilibili.com/video/BV1xx0000aa' },
          { sample: 'BV2yy1111bb here' },
        ],
      },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['辣眼睛'], batch: 12 });
    assert.equal(plan.ok, true);
    assert.equal(plan.plannedCount, 1);
    assert.equal(plan.plans[0].term, '辣眼睛');
    assert.equal(plan.plans[0].family, 'attack');
    assert.equal(plan.plans[0].evidenceNeeded, 1); // targetEvidence(3) - 2
    assert.ok(plan.plans[0].bvids.length >= 1);
  });

  test('skips a term whose evidenceSources contain no BVID', () => {
    const dict = dictWith([
      { term: 'nobvid', family: 'attack', evidenceCount: 1, evidenceSources: [{ sample: 'no link here' }] },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['nobvid'] });
    assert.equal(plan.plannedCount, 0);
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].reason, 'no_source_bvids');
  });

  test('override term not in dictionary is dropped from candidates', () => {
    const dict = dictWith([{ term: 'real', family: 'x', evidenceCount: 0 }]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['real', 'ghost'] });
    assert.deepEqual(plan.candidateTerms, ['real']);
  });

  test('respects the batch limit (only first batch terms get plans)', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      term: `t${i}`,
      family: 'attack',
      evidenceCount: 0,
      evidenceSources: [{ sample: `BV${String(i).padStart(10, 'x')}` }],
    }));
    const plan = buildResolveNearTargetPlan(dictWith(entries), {}, { overrideTerms: entries.map((e) => e.term), batch: 2 });
    assert.equal(plan.candidateCount, 5);
    assert.equal(plan.plannedCount, 2);
  });

  test('evidenceNeeded falls back to evidenceSamples length when evidenceCount missing', () => {
    const dict = dictWith([
      {
        term: 'samplesOnly',
        family: 'attack',
        evidenceSamples: ['s1'],
        evidenceSources: [{ sample: 'BV1xxxxxxxx' }],
      },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['samplesOnly'] });
    // targetEvidence(3) - evidenceSamples.length(1) = 2
    assert.equal(plan.plans[0].evidenceNeeded, 2);
  });

  test('videosPlanned is the sum of bvids across plans', () => {
    const dict = dictWith([
      { term: 'a', family: 'x', evidenceCount: 0, evidenceSources: [{ sample: 'BV1aaaaaaaa BV1bbbbbbbb' }] },
      { term: 'b', family: 'x', evidenceCount: 0, evidenceSources: [{ sample: 'BV1cccccccc' }] },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['a', 'b'], videosPerTerm: 3 });
    assert.equal(plan.videosPlanned, plan.plans.reduce((n, p) => n + p.bvids.length, 0));
  });

  test('targetExistingTerms in each plan includes the term itself plus pool needles', () => {
    const dict = dictWith([
      { term: 'a', family: 'x', evidenceCount: 0, evidenceSources: [{ sample: 'BV1aaaaaaaa' }] },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { overrideTerms: ['a'] });
    assert.ok(plan.plans[0].targetExistingTerms.includes('a'));
  });

  test('default (no overrides) requires comment-backed evidence to surface candidates', () => {
    // buildResolveNearTargetPlan runs buildDictionaryCoverageAudit with
    // requireCommentBackedEvidence:true. Entries whose evidenceSources lack
    // proper comment-backed sourcing do NOT appear in nextActions, so the
    // default path safely returns no candidates for such minimal fixtures.
    const dict = dictWith([
      { term: 'near', family: 'x', evidenceCount: 2, evidenceSources: [{ sample: 'BV1aaaaaaaa' }] },
      { term: 'far', family: 'x', evidenceCount: 0, evidenceSources: [{ sample: 'BV1bbbbbbbb' }] },
    ]);
    const plan = buildResolveNearTargetPlan(dict, {}, { maxNeed: 1 });
    assert.equal(plan.ok, true);
    assert.ok(Array.isArray(plan.candidateTerms));
    // without comment-backed evidence, no candidates surface (safe default)
    assert.equal(plan.plannedCount, 0);
  });
});
