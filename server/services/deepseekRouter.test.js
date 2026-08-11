/**
 * Tests for deepseekRouter.js — centralized DeepSeek model + effort resolution.
 *
 * Covers the full override chain for resolveModel and resolveReasoningEffort:
 *   1. explicit caller option (highest priority)
 *   2. task-specific env var
 *   3. global env var
 *   4. task-category default
 * Plus selectBestModel fallback ordering and downgradeToFlash.
 *
 * All env-dependent cases pass an explicit { env } object so the real
 * process.env is never mutated.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  resolveModel,
  resolveReasoningEffort,
  selectBestModel,
  downgradeToFlash,
  MODELS,
  V4_MODELS,
} from './deepseekRouter.js';

describe('resolveModel override chain', () => {
  test('1) explicit options.model wins over everything', () => {
    const env = { DEEPSEEK_MODEL: 'env-global', BILIBILI_HARVEST_MODEL: 'env-harvest' };
    assert.equal(resolveModel('harvest', { model: 'caller-model', env }), 'caller-model');
  });

  test('2) task-specific env var beats global env var', () => {
    const env = { DEEPSEEK_MODEL: 'env-global', BILIBILI_HARVEST_MODEL: 'env-harvest' };
    assert.equal(resolveModel('harvest', { env }), 'env-harvest');
  });

  test('2b) annotate task uses DEEPSEEK_ANNOTATION_MODEL', () => {
    const env = { DEEPSEEK_MODEL: 'env-global', DEEPSEEK_ANNOTATION_MODEL: 'env-annotate' };
    assert.equal(resolveModel('annotate', { env }), 'env-annotate');
  });

  test('3) global DEEPSEEK_MODEL applies when no task-specific override', () => {
    const env = { DEEPSEEK_MODEL: 'env-global' };
    assert.equal(resolveModel('analyze', { env }), 'env-global');
    assert.equal(resolveModel('harvest', { env }), 'env-global'); // no BILIBILI_HARVEST_MODEL
  });

  test('4a) pro-task default → V4_PRO', () => {
    assert.equal(resolveModel('think', { env: {} }), MODELS.V4_PRO);
    assert.equal(resolveModel('plan', { env: {} }), MODELS.V4_PRO);
    assert.equal(resolveModel('train', { env: {} }), MODELS.V4_PRO);
    assert.equal(resolveModel('generate', { env: {} }), MODELS.V4_PRO);
    assert.equal(resolveModel('reasoning', { env: {} }), MODELS.V4_PRO);
  });

  test('4b) flash-task (and unknown) default → V4_FLASH', () => {
    assert.equal(resolveModel('harvest', { env: {} }), MODELS.V4_FLASH);
    assert.equal(resolveModel('analyze', { env: {} }), MODELS.V4_FLASH);
    assert.equal(resolveModel('annotate', { env: {} }), MODELS.V4_FLASH);
    assert.equal(resolveModel('coverage', { env: {} }), MODELS.V4_FLASH);
    // unknown task falls through to flash default
    assert.equal(resolveModel('totally-unknown-task', { env: {} }), MODELS.V4_FLASH);
  });

  test('defaults task to "analyze" when omitted', () => {
    // call with no args at all
    assert.equal(resolveModel(undefined, { env: {} }), MODELS.V4_FLASH);
  });

  test('empty-string task-specific env var does NOT override (falls through)', () => {
    const env = { BILIBILI_HARVEST_MODEL: '', DEEPSEEK_MODEL: 'env-global' };
    assert.equal(resolveModel('harvest', { env }), 'env-global');
  });
});

describe('resolveReasoningEffort override chain', () => {
  test('1) explicit options.effort wins', () => {
    assert.equal(
      resolveReasoningEffort('harvest', { effort: 'low', env: { BILIBILI_HARVEST_REASONING_EFFORT: 'medium' } }),
      'low',
    );
  });

  test('2a) harvest task uses BILIBILI_HARVEST_REASONING_EFFORT', () => {
    const env = { BILIBILI_HARVEST_REASONING_EFFORT: 'low', DEEPSEEK_REASONING_EFFORT: 'high' };
    assert.equal(resolveReasoningEffort('harvest', { env }), 'low');
  });

  test('2b) annotate task uses DEEPSEEK_ANNOTATION_EFFORT', () => {
    const env = { DEEPSEEK_ANNOTATION_EFFORT: 'medium', DEEPSEEK_REASONING_EFFORT: 'high' };
    assert.equal(resolveReasoningEffort('annotate', { env }), 'medium');
  });

  test('3) global DEEPSEEK_REASONING_EFFORT applies for non-harvest/annotate tasks', () => {
    const env = { DEEPSEEK_REASONING_EFFORT: 'high' };
    assert.equal(resolveReasoningEffort('analyze', { env }), 'high');
  });

  test('4a) pro-task default → high', () => {
    assert.equal(resolveReasoningEffort('think', { env: {} }), 'high');
    assert.equal(resolveReasoningEffort('generate', { env: {} }), 'high');
  });

  test('4b) flash-task default → max', () => {
    assert.equal(resolveReasoningEffort('analyze', { env: {} }), 'max');
    assert.equal(resolveReasoningEffort('harvest', { env: {} }), 'max');
  });

  test('defaults task to "analyze" when omitted', () => {
    assert.equal(resolveReasoningEffort(undefined, { env: {} }), 'max');
  });
});

describe('selectBestModel fallback', () => {
  test('returns configured model when available', () => {
    assert.equal(selectBestModel(MODELS.V4_PRO, [MODELS.V4_FLASH, MODELS.V4_PRO]), MODELS.V4_PRO);
  });

  test('falls back to V4_PRO when configured missing but pro available', () => {
    assert.equal(selectBestModel('custom-model', [MODELS.V4_PRO, 'other']), MODELS.V4_PRO);
  });

  test('falls back to V4_FLASH when neither configured nor pro available', () => {
    assert.equal(selectBestModel('custom-model', [MODELS.V4_FLASH, 'other']), MODELS.V4_FLASH);
  });

  test('returns configured model unchanged when nothing recognized is available', () => {
    assert.equal(selectBestModel('custom-model', ['other1', 'other2']), 'custom-model');
  });

  test('handles empty available list', () => {
    assert.equal(selectBestModel('custom-model', []), 'custom-model');
  });
});

describe('downgradeToFlash', () => {
  test('always returns V4_FLASH regardless of input', () => {
    assert.equal(downgradeToFlash(MODELS.V4_PRO), MODELS.V4_FLASH);
    assert.equal(downgradeToFlash('anything'), MODELS.V4_FLASH);
    assert.equal(downgradeToFlash(''), MODELS.V4_FLASH);
  });
});

describe('constants', () => {
  test('MODELS is frozen and holds the two V4 names', () => {
    assert.equal(Object.isFrozen(MODELS), true);
    assert.equal(MODELS.V4_FLASH, 'deepseek-v4-flash');
    assert.equal(MODELS.V4_PRO, 'deepseek-v4-pro');
  });

  test('V4_MODELS lists both and is frozen', () => {
    assert.equal(Object.isFrozen(V4_MODELS), true);
    assert.deepEqual([...V4_MODELS], ['deepseek-v4-flash', 'deepseek-v4-pro']);
  });
});
