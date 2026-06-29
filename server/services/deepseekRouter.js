/**
 * Centralized DeepSeek model router — single source of truth for model selection.
 *
 * Task-based routing:
 *   think / plan / train / complex / generate / reasoning → deepseek-v4-pro
 *   analyze / implement / harvest / light / annotate / eval / coverage → deepseek-v4-flash
 *
 * Override chain (highest priority first):
 *   1. Explicit options.model passed by caller
 *   2. Task-specific env var (e.g. BILIBILI_HARVEST_MODEL for harvest tasks)
 *   3. DEEPSEEK_MODEL env var
 *   4. Task-category default (pro / flash)
 *
 * Usage:
 *   import { resolveModel, MODELS, V4_MODELS } from '../services/deepseekRouter.js';
 *   const model = resolveModel('harvest', { env: process.env });
 */

// ── Model constants ──────────────────────────────────────────────────────────

export const MODELS = Object.freeze({
  V4_FLASH: 'deepseek-v4-flash',
  V4_PRO: 'deepseek-v4-pro',
});

/** Canonical list of supported V4 models (used by config/status endpoints). */
export const V4_MODELS = Object.freeze([MODELS.V4_FLASH, MODELS.V4_PRO]);

// ── Task categories ──────────────────────────────────────────────────────────

const PRO_TASKS = new Set([
  'think',
  'plan',
  'train',
  'complex',
  'generate',
  'reasoning',
]);

const FLASH_TASKS = new Set([
  'analyze',
  'implement',
  'harvest',
  'light',
  'annotate',
  'eval',
  'coverage',
  'disambiguate',
  'relation',
  'classify',
]);

// ── Task-specific env overrides ──────────────────────────────────────────────

const TASK_ENV_OVERRIDES = {
  harvest: 'BILIBILI_HARVEST_MODEL',
  annotate: 'DEEPSEEK_ANNOTATION_MODEL',
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the DeepSeek model for a given task category.
 *
 * @param {string} [task='analyze'] - task category (harvest, annotate, generate, train, etc.)
 * @param {object} [options]
 * @param {string} [options.model] - explicit model override (highest priority)
 * @param {object} [options.env] - environment object (defaults to process.env)
 * @returns {string} the resolved model name
 */
export function resolveModel(task = 'analyze', options = {}) {
  // 1. Explicit caller override
  if (options.model) return options.model;

  const env = options.env || process.env;

  // 2. Task-specific env var
  const taskEnvVar = TASK_ENV_OVERRIDES[task];
  if (taskEnvVar && env[taskEnvVar]) return env[taskEnvVar];

  // 3. Global DEEPSEEK_MODEL env var
  if (env.DEEPSEEK_MODEL) return env.DEEPSEEK_MODEL;

  // 4. Task-category default
  if (PRO_TASKS.has(task)) return MODELS.V4_PRO;
  return MODELS.V4_FLASH;
}

/**
 * Resolve the reasoning effort for a given task.
 *
 * @param {string} [task='analyze']
 * @param {object} [options]
 * @param {string} [options.effort] - explicit effort override
 * @param {object} [options.env] - environment object (defaults to process.env)
 * @returns {string} 'max', 'high', 'medium', or 'low'
 */
export function resolveReasoningEffort(task = 'analyze', options = {}) {
  if (options.effort) return options.effort;

  const env = options.env || process.env;

  // Task-specific effort env var
  if (task === 'harvest' && env.BILIBILI_HARVEST_REASONING_EFFORT) {
    return env.BILIBILI_HARVEST_REASONING_EFFORT;
  }
  if (task === 'annotate' && env.DEEPSEEK_ANNOTATION_EFFORT) {
    return env.DEEPSEEK_ANNOTATION_EFFORT;
  }

  // Global effort env var
  if (env.DEEPSEEK_REASONING_EFFORT) return env.DEEPSEEK_REASONING_EFFORT;

  // Pro tasks default to high reasoning, flash tasks to max (flash needs more guidance)
  if (PRO_TASKS.has(task)) return 'high';
  return 'max';
}

/**
 * Select the best available model from a list, preferring the configured model.
 * Used by config/status endpoints that have a live model list from the API.
 *
 * @param {string} configuredModel - the desired model
 * @param {string[]} availableModels - models reported by the API
 * @returns {string} the best available model
 */
export function selectBestModel(configuredModel, availableModels) {
  if (availableModels.includes(configuredModel)) return configuredModel;
  if (availableModels.includes(MODELS.V4_PRO)) return MODELS.V4_PRO;
  if (availableModels.includes(MODELS.V4_FLASH)) return MODELS.V4_FLASH;
  return configuredModel;
}

/**
 * Downgrade pro → flash for tasks that don't need reasoning.
 * Some code paths force flash even when pro is configured (e.g. keyword
 * training analysis uses flash for cost/speed regardless of env model).
 *
 * @param {string} currentModel - the currently active model
 * @returns {string} flash model
 */
export function downgradeToFlash(_currentModel) {
  return MODELS.V4_FLASH;
}
