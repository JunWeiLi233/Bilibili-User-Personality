/**
 * Tests for previously-untested exports:
 *   - disambiguator.contextAwareDisambiguate / contextAwareDisambiguateWithPMI:
 *     composite-rule disambiguation, scenario biasing, weight boost, PMI
 *     augmentation flag.
 *   - huggingFaceCorpus.uniqueHuggingFaceComments: dedup by
 *     platform+source+message, drop empty-message rows.
 *   - coverageProgress.actionProgressDelta: action-term resolution + evidence-
 *     need reduction deltas between before/after action lists.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  contextAwareDisambiguate,
  contextAwareDisambiguateWithPMI,
  loadComposites,
  clearRulesCache,
} from './disambiguator.js';
import { uniqueHuggingFaceComments } from './huggingFaceCorpus.js';
import { actionProgressDelta } from '../utils/coverageProgress.js';

// ---------------------------------------------------------------------------
// contextAwareDisambiguate / contextAwareDisambiguateWithPMI
// ---------------------------------------------------------------------------

describe('contextAwareDisambiguate', () => {
  test('confirms terms matched by a composite rule (不是X就是Y → comp-001)', () => {
    const r = contextAwareDisambiguate('不是傻就是蠢', [{ term: '不是', weight: 1 }, { term: '就是', weight: 1 }]);
    assert.equal(r.filtered.length, 2);
    for (const f of r.filtered) {
      assert.equal(f.action, 'confirm');
      assert.ok(f.weight > 1, 'confirm boosts weight above base');
    }
  });

  test('returns scenario + stats alongside filtered matches', () => {
    const r = contextAwareDisambiguate('无关文本', [{ term: '不存在', weight: 1 }]);
    assert.ok(r.scenario && typeof r.scenario.scenario === 'string');
    assert.ok(typeof r.stats === 'object');
  });

  test('terms with no matching rule pass through as neutral', () => {
    const r = contextAwareDisambiguate('一些文本', [{ term: '没有规则的词xyz', weight: 1 }]);
    assert.equal(r.filtered.length, 1);
    assert.equal(r.filtered[0].action, 'neutral');
    assert.equal(r.filtered[0].reason, 'no_rules_for_term');
  });

  test('handles empty keywordMatches', () => {
    const r = contextAwareDisambiguate('一些文本', []);
    assert.deepEqual(r.filtered, []);
  });
});

describe('contextAwareDisambiguateWithPMI', () => {
  test('returns pmiAugmented flag (true when a PMI boost applied, false otherwise)', () => {
    // composite confirm but no PMI overlap → pmiAugmented likely false
    const r = contextAwareDisambiguateWithPMI('不是傻就是蠢', [{ term: '不是', weight: 1 }, { term: '就是', weight: 1 }]);
    assert.ok(typeof r.pmiAugmented === 'boolean');
    assert.ok(Array.isArray(r.filtered));
    assert.equal(r.filtered.length, 2);
  });

  test('preserves the base disambiguation result shape (filtered/stats/scenario)', () => {
    const r = contextAwareDisambiguateWithPMI('无关文本', [{ term: 'x', weight: 1 }]);
    assert.ok('filtered' in r);
    assert.ok('stats' in r);
    assert.ok('scenario' in r);
  });

  test('each filtered result has a numeric weight', () => {
    const r = contextAwareDisambiguateWithPMI('不是傻就是蠢', [{ term: '不是', weight: 1 }]);
    for (const f of r.filtered) {
      assert.equal(typeof f.weight, 'number');
    }
  });
});

describe('disambiguator loadComposites / clearRulesCache', () => {
  test('loadComposites returns an array (the rules file ships composites)', () => {
    clearRulesCache();
    const composites = loadComposites();
    assert.ok(Array.isArray(composites));
    assert.ok(composites.length > 0, 'expected composites to be populated from rules file');
  });

  test('each composite has the expected shape', () => {
    clearRulesCache();
    const composites = loadComposites();
    for (const c of composites.slice(0, 3)) {
      assert.ok(Array.isArray(c.terms));
      assert.ok(typeof c.pattern === 'string');
      assert.ok(['confirm', 'suppress'].includes(c.action));
    }
  });
});

// ---------------------------------------------------------------------------
// uniqueHuggingFaceComments
// ---------------------------------------------------------------------------

describe('uniqueHuggingFaceComments', () => {
  test('dedups by platform+source+message composite key', () => {
    const a = { platform: 'bilibili', sourceUrl: 'u1', message: 'hello' };
    const dup = { platform: 'bilibili', sourceUrl: 'u1', message: 'hello' };
    const out = [...uniqueHuggingFaceComments([a, dup])];
    assert.equal(out.length, 1);
  });

  test('keeps comments that differ only by message', () => {
    const out = [...uniqueHuggingFaceComments([
      { platform: 'bilibili', sourceUrl: 'u1', message: 'hello' },
      { platform: 'bilibili', sourceUrl: 'u1', message: 'world' },
    ])];
    assert.equal(out.length, 2);
  });

  test('drops comments with empty/whitespace/missing message', () => {
    const out = [...uniqueHuggingFaceComments([
      { platform: 'bilibili', sourceUrl: 'u1', message: '' },
      { platform: 'bilibili', sourceUrl: 'u2', message: '   ' },
      { message: null },
      {},
      { platform: 'bilibili', sourceUrl: 'u3', message: 'keep' },
    ])];
    assert.equal(out.length, 1);
    assert.equal(out[0].message, 'keep');
  });

  test('returns empty iterator for empty input', () => {
    assert.deepEqual([...uniqueHuggingFaceComments([])], []);
    assert.deepEqual([...uniqueHuggingFaceComments(null)], []);
  });

  test('falls back to source field when sourceUrl absent', () => {
    // two rows same platform+source+message → deduped
    const out = [...uniqueHuggingFaceComments([
      { platform: 'p', source: 's', message: 'm' },
      { platform: 'p', source: 's', message: 'm' },
    ])];
    assert.equal(out.length, 1);
  });
});

// ---------------------------------------------------------------------------
// actionProgressDelta
// ---------------------------------------------------------------------------

describe('actionProgressDelta', () => {
  test('counts a term as resolved when present in before but absent in after', () => {
    const delta = actionProgressDelta(
      [{ term: 'gone', evidenceNeeded: 2 }],
      [{ term: 'other', evidenceNeeded: 1 }],
    );
    assert.equal(delta.actionTermsResolved, 1);
    assert.equal(delta.actionEvidenceNeedReduced, 2);
  });

  test('reduces evidence need when a term’s need drops between before and after', () => {
    const delta = actionProgressDelta(
      [{ term: 'a', evidenceNeeded: 3 }],
      [{ term: 'a', evidenceNeeded: 1 }],
    );
    assert.equal(delta.actionTermsResolved, 0);
    assert.equal(delta.actionEvidenceNeedReduced, 2);
  });

  test('uses .needs when present (preferred over evidenceNeeded)', () => {
    const delta = actionProgressDelta(
      [{ term: 'a', needs: 5, evidenceNeeded: 1 }],
      [{ term: 'a', needs: 2 }],
    );
    assert.equal(delta.actionEvidenceNeedReduced, 3);
  });

  test('does not count negative need reductions (after need > before need)', () => {
    const delta = actionProgressDelta(
      [{ term: 'a', evidenceNeeded: 1 }],
      [{ term: 'a', evidenceNeeded: 5 }],
    );
    assert.equal(delta.actionEvidenceNeedReduced, 0);
  });

  test('handles empty inputs', () => {
    const d1 = actionProgressDelta([], []);
    assert.deepEqual(d1, { actionTermsResolved: 0, actionEvidenceNeedReduced: 0 });
    const d2 = actionProgressDelta(null, null);
    assert.deepEqual(d2, { actionTermsResolved: 0, actionEvidenceNeedReduced: 0 });
  });

  test('skips actions with no term', () => {
    const delta = actionProgressDelta(
      [{ term: '', evidenceNeeded: 5 }, { term: 'a', evidenceNeeded: 1 }],
      [],
    );
    assert.equal(delta.actionTermsResolved, 1); // only 'a', not the empty-term one
  });
});
