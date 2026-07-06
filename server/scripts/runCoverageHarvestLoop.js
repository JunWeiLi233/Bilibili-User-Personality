import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { readKeywordDictionary, writeJsonFileAtomic, writeSplitDictionaryAtomic, DEFAULT_DICTIONARY_PATH } from '../services/deepseekKeywordTrainer.js';
import { coverageDeltaFromHarvest, hasCoverageDeltaProgress } from '../utils/coverageProgress.js';
import { buildCoverageRuntimeOptions } from '../utils/coverageCliOptions.js';
import { createCoverageCheckpoint, pruneOldCheckpoints } from '../services/coverageCheckpoint.js';
import {
  buildDictionaryCoverageAudit,
  DEFAULT_HARVEST_STATE_PATH,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
  selectExhaustedTerms,
} from '../services/keywordHarvest.js';

import { MODELS } from '../services/deepseekRouter.js';

// Default to flash/max for the auto-coverage loop, but allow an explicit opt-in
// override (pro-model validation) via a dedicated env var. A stray DEEPSEEK_MODEL
// in the environment is still ignored, preserving the default-flash contract.
process.env.DEEPSEEK_MODEL = process.env.BILIBILI_HARVEST_MODEL || MODELS.V4_FLASH;
process.env.DEEPSEEK_REASONING_EFFORT = process.env.BILIBILI_HARVEST_REASONING_EFFORT || 'max';

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  // Don't exit — let the cycle-level try/catch handle it next iteration
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Classify a coverage-loop error as transient (worth retrying with backoff) vs fatal
 * (config/programming/missing-input — stop). Pure, no I/O — isolated so the resilience
 * policy is unit-testable without DEEPSEEK_API_KEY or network.
 */
export function isTransientCoverageError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error?.code || error || '');
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ESOCKETTIMEDOUT/.test(code)) return true;
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|socket hang up|fetch failed|getaddrinfo|network/i.test(msg)) return true;
  if (/\b429\b|\b5\d\d\b/.test(msg)) return true;
  if (/rate.?limit|too many requests|service unavailable|bad gateway|timeout|timed out|temporary|overloaded|retry/i.test(msg)) return true;
  return false;
}

/** Exponential backoff with full jitter, capped at `cap` ms. Pure. */
export function computeBackoffMs(attempt, base = 5000, cap = 120000) {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  // Jitter only, not crypto — deterministic enough for backoff spacing.
  // nodejsscan: suppress — Math.random is appropriate for jitter, not a security primitive.
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

/**
 * Decide whether to auto-restart the whole coverage run. Pure: caller supplies counters.
 * Restart while the gate is unmet, restarts remain, and progress is still happening.
 */
export function shouldRestartRun({ auditOk, restartsUsed, maxRestarts, consecutiveNoProgress, maxConsecutiveNoProgress }) {
  if (auditOk) return false;
  if (restartsUsed >= maxRestarts) return false;
  if (consecutiveNoProgress >= maxConsecutiveNoProgress) return false;
  return true;
}

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveIntFromEnv(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function nonNegativeIntFromEnv(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function flagFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function priorityQueryItemsFromAudit(audit, limit) {
  return (audit.nextActions || [])
    .flatMap((item) => {
      const queries = [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]
        .map((query) => String(query || '').trim())
        .filter(Boolean);
      return queries.map((query) => ({ ...item, query, nextQuery: query }));
    })
    .slice(0, limit);
}

function parsePlanArgs(argv = process.argv.slice(2)) {
  let planJson = false;
  let pythonPlan = false;
  let coverageProgressJson = false;
  let pythonCommand = false;
  let payloadPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--plan-json') {
      planJson = true;
    } else if (arg === '--python-plan') {
      pythonPlan = true;
    } else if (arg === '--coverage-progress-json') {
      coverageProgressJson = true;
    } else if (arg === '--python-command') {
      pythonCommand = true;
    } else if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length);
    } else if (arg === '--payload') {
      payloadPath = String(argv[index + 1] || '');
      index += 1;
    }
  }
  return { planJson, pythonPlan, coverageProgressJson, pythonCommand, payloadPath };
}

async function readPlanPayload(path) {
  if (!path) return {};
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function planPositiveInt(env, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function planNonNegativeInt(env, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function planFlag(env, name, fallback = false) {
  const value = env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function buildCoverageHarvestLoopPlan(payload = {}) {
  const env = payload && typeof payload.env === 'object' && payload.env ? payload.env : {};
  const argv = Array.isArray(payload?.argv) ? payload.argv : [];
  const cwd = String(payload?.cwd || process.cwd());
  const dataDir = join(cwd, 'server', 'data');
  const maxCyclesValue = planNonNegativeInt(env, 'BILIBILI_COVERAGE_LOOP_MAX_CYCLES', 3, 1000);
  const roundsFallback = planPositiveInt(env, 'BILIBILI_HARVEST_ROUNDS', 1);
  const roundsPerCycleValue = planPositiveInt(env, 'BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE', roundsFallback, 20);
  const maxQueriesValue = planPositiveInt(env, 'BILIBILI_HARVEST_MAX_QUERIES', 12, 500);
  const runtime = buildCoverageRuntimeOptions({ argv, env, maxActionsFallback: maxQueriesValue });
  const seedQueriesValue = parseList(env.BILIBILI_VIDEO_SEARCH_QUERIES || env.BILIBILI_VIDEO_SEARCH_QUERY);
  const controversyQueriesValue = parseList(env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
  const extraTemplates = parseList(env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
  const exhaustedTemplates = parseList(env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
  const existingOnly = env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1';
  const commentBacked = Boolean(runtime.requireCommentBackedEvidence);
  const defaultStatePath = join(dataDir, 'keywordHarvestState.json');
  const defaultReportPath = join(dataDir, 'keywordCoverageLoopReport.json');
  const prioritizeNear = planFlag(env, 'BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET', false);
  const audit = payload && typeof payload.audit === 'object' && payload.audit ? payload.audit : {};
  const auditOptionsPlan = {
    dictionaryPath: env.DEEPSEEK_KEYWORD_DICTIONARY_PATH || null,
    statePath: env.BILIBILI_HARVEST_STATE_PATH || defaultStatePath,
    targetEvidence: runtime.targetEvidence,
    maxActions: runtime.maxActions,
    minCoverageRatio: runtime.minCoverageRatio,
    requireComplete: runtime.requireComplete,
    requireSourceBackedEvidence: runtime.requireSourceBackedEvidence,
    requireCommentBackedEvidence: runtime.requireCommentBackedEvidence,
    prioritizeSourceGaps: commentBacked,
    prioritizeNearTarget: prioritizeNear,
    extraQueryTemplates: extraTemplates,
    exhaustedSuggestionTemplates: exhaustedTemplates,
    retryBeforeUnattemptedLimit: runtime.retryBeforeUnattemptedLimit,
  };
  const harvestOptionsPlan = {
    priorityQueries: [],
    seedQueries: seedQueriesValue,
    controversyQueries: controversyQueriesValue,
    maxQueries: maxQueriesValue,
    termsPerFamily: planPositiveInt(env, 'BILIBILI_HARVEST_TERMS_PER_FAMILY', 4, 20),
    queryVariantsPerTerm: planPositiveInt(env, 'BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2, 20),
    extraQueryTemplates: extraTemplates,
    exhaustedSuggestionTemplates: exhaustedTemplates,
    retryBeforeUnattemptedLimit: runtime.retryBeforeUnattemptedLimit,
    maxHardMissedQueries: planNonNegativeInt(env, 'BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES', Math.max(2, Math.ceil(maxQueriesValue / 2)), 100),
    staleMissedDiscoveryLimit: planNonNegativeInt(env, 'BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT', 4, 20),
    staleMissedPages: planNonNegativeInt(env, 'BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES', 3, 5),
    targetEvidence: runtime.targetEvidence,
    coverageMode: String(env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase(),
    requireSourceBackedEvidence: runtime.requireSourceBackedEvidence,
    requireCommentBackedEvidence: runtime.requireCommentBackedEvidence,
    prioritizeSourceGaps: commentBacked,
    commentPoolTargetTermsLimit: planPositiveInt(env, 'BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT', 24, 200),
    priorityCommentPoolTargets: planFlag(env, 'BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS', false),
    preFilterCommentsToTargets: planFlag(env, 'BILIBILI_HARVEST_PREFILTER_COMMENTS', false),
    deepenReplyThreads: planFlag(env, 'BILIBILI_HARVEST_DEEPEN_REPLIES', false),
    verbose: planFlag(env, 'BILIBILI_HARVEST_VERBOSE', true),
    prioritizeNearTarget: prioritizeNear,
    existingTermsOnly: existingOnly,
    discoveryMode: String(env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase(),
    discoveryLimit: planPositiveInt(env, 'BILIBILI_VIDEO_DISCOVERY_LIMIT', 6, 20),
    discoveryPages: planPositiveInt(env, 'BILIBILI_VIDEO_DISCOVERY_PAGES', 1, 5),
    controversialPopularQueryLimit: planNonNegativeInt(env, 'BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT', 4, 20),
    controversialPopularSearchOrder: String(env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click').trim().toLowerCase(),
    includeGenericPopular: planFlag(env, 'BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR', false),
    includeDanmaku: planFlag(env, 'BILIBILI_HARVEST_INCLUDE_DANMAKU', false),
    pages: planPositiveInt(env, 'BILIBILI_VIDEO_COMMENT_PAGES', 2, 20),
    perQueryTimeoutMs: planPositiveInt(env, 'BILIBILI_HARVEST_QUERY_TIMEOUT_MS', 180000, 30 * 60 * 1000),
    expandTargetsFromComments: planFlag(env, 'BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS', existingOnly && commentBacked),
    rounds: roundsPerCycleValue,
    statePath: auditOptionsPlan.statePath,
    resetState: env.BILIBILI_HARVEST_RESET === '1',
    skipSeen: env.BILIBILI_HARVEST_SKIP_SEEN !== '0',
    queryConcurrency: planPositiveInt(env, 'BILIBILI_HARVEST_QUERY_CONCURRENCY', 1, 16),
  };
  return {
    ok: true,
    deepseek: {
      model: env.BILIBILI_HARVEST_MODEL || MODELS.V4_FLASH,
      reasoningEffort: env.BILIBILI_HARVEST_REASONING_EFFORT || 'max',
    },
    paths: {
      dictionaryPath: auditOptionsPlan.dictionaryPath,
      statePath: auditOptionsPlan.statePath,
      reportPath: env.BILIBILI_COVERAGE_LOOP_REPORT_PATH || defaultReportPath,
    },
    loop: { maxCycles: maxCyclesValue, roundsPerCycle: roundsPerCycleValue, maxQueries: maxQueriesValue },
    auditOptions: auditOptionsPlan,
    harvestOptions: harvestOptionsPlan,
    lists: {
      seedQueries: seedQueriesValue,
      controversyQueries: controversyQueriesValue,
      extraQueryTemplates: extraTemplates,
      exhaustedSuggestionTemplates: exhaustedTemplates,
    },
    prune: {
      pruneExhaustedAfter: planNonNegativeInt(env, 'BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER', 0, 100000),
      pruneIncludePartial: env.BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL === '1',
    },
    strict: runtime.strict,
    priorityQueries: priorityQueryItemsFromAudit(audit, maxQueriesValue),
    initialStopReason: audit.ok ? 'coverage_gate_passed' : maxCyclesValue === 0 ? 'cycle_limit' : '',
  };
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await writeFile(path, `${json}\n`, 'utf8');
}

function buildJsCoverageProgress(payload = {}) {
  const before = payload?.before && typeof payload.before === 'object' ? payload.before : {};
  const after = payload?.after && typeof payload.after === 'object' ? payload.after : {};
  const harvestProgress = Array.isArray(payload?.harvestProgress) ? payload.harvestProgress : [];
  const delta = coverageDeltaFromHarvest(before, after, harvestProgress);
  return {
    ok: true,
    harvestDelta: delta,
    hasHarvestProgress: hasCoverageDeltaProgress(delta),
  };
}

async function runPythonCoverageProgress(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.coverage_progress', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonCoverageLoopPlan(payloadPath) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.coverage_loop_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export function buildPythonCoverageLoopCommandArgs(options = {}) {
  const args = [
    '-m',
    'python_backend.cli.coverage_loop_command',
    '--dictionary',
    options.dictionaryPath || DEFAULT_DICTIONARY_PATH,
    '--state',
    options.statePath,
    '--report',
    options.reportPath,
    '--max-cycles',
    String(options.maxCycles),
    '--rounds-per-cycle',
    String(options.roundsPerCycle),
    '--max-queries',
    String(options.maxQueries),
    '--target-evidence',
    String(options.targetEvidence),
    '--max-actions',
    String(options.maxActions),
    '--min-coverage-ratio',
    String(options.minCoverageRatio),
  ];
  if (!options.requireComplete) args.push('--allow-incomplete');
  if (options.requireSourceBackedEvidence) args.push('--require-source-backed-evidence');
  if (options.requireCommentBackedEvidence) args.push('--require-comment-backed-evidence');
  if (options.includeDanmaku) args.push('--include-danmaku');
  if (options.resetState) args.push('--reset-state');
  if (!options.skipSeen) args.push('--no-skip-seen');
  if (options.stopOnNoProgress) args.push('--stop-on-no-progress');
  if (options.pruneExhaustedAfter > 0) args.push('--prune-exhausted-after', String(options.pruneExhaustedAfter));
  if (options.pruneIncludePartial) args.push('--prune-include-partial');
  if (options.harvestCommandJson) args.push('--harvest-command-json', options.harvestCommandJson);
  for (const query of options.seedQueries || []) args.push('--seed-query', query);
  for (const query of options.controversyQueries || []) args.push('--controversy-query', query);
  if (options.discoveryMode) args.push('--discovery-mode', options.discoveryMode);
  if (options.termsPerFamily) args.push('--terms-per-family', String(options.termsPerFamily));
  if (options.queryVariantsPerTerm) args.push('--query-variants-per-term', String(options.queryVariantsPerTerm));
  for (const template of options.extraQueryTemplates || []) args.push('--extra-query-template', template);
  for (const template of options.exhaustedSuggestionTemplates || []) {
    args.push('--exhausted-suggestion-template', template);
  }
  if (options.discoveryLimit) args.push('--discovery-limit', String(options.discoveryLimit));
  if (options.discoveryPages) args.push('--discovery-pages', String(options.discoveryPages));
  if (options.includeGenericPopular) args.push('--include-generic-popular');
  if (options.maxHardMissedQueries != null) args.push('--max-hard-missed-queries', String(options.maxHardMissedQueries));
  if (options.staleMissedDiscoveryLimit != null) {
    args.push('--stale-missed-discovery-limit', String(options.staleMissedDiscoveryLimit));
  }
  if (options.staleMissedPages != null) args.push('--stale-missed-pages', String(options.staleMissedPages));
  if (options.coverageMode) args.push('--coverage-mode', options.coverageMode);
  if (options.commentPoolTargetTermsLimit != null) {
    args.push('--comment-pool-target-limit', String(options.commentPoolTargetTermsLimit));
  }
  if (options.priorityCommentPoolTargets) args.push('--priority-comment-pool-targets');
  if (options.preFilterCommentsToTargets) args.push('--pre-filter-comments-to-targets');
  if (options.deepenReplyThreads) args.push('--deepen-reply-threads');
  if (options.verbose === false) args.push('--quiet');
  if (options.prioritizeNearTarget) args.push('--prioritize-near-target');
  if (options.existingTermsOnly) args.push('--existing-terms-only');
  if (options.controversialPopularQueryLimit != null) {
    args.push('--controversial-popular-query-limit', String(options.controversialPopularQueryLimit));
  }
  if (options.controversialPopularSearchOrder) {
    args.push('--controversial-popular-search-order', options.controversialPopularSearchOrder);
  }
  if (options.pages) args.push('--pages', String(options.pages));
  if (options.perQueryTimeoutMs) args.push('--per-query-timeout-ms', String(options.perQueryTimeoutMs));
  if (options.expandTargetsFromComments) args.push('--expand-targets-from-comments');
  if (!options.strict) args.push('--exit-zero');
  return args;
}

async function runPythonCoverageLoopCommand(options = {}) {
  const args = buildPythonCoverageLoopCommandArgs(options);
  const { stdout, stderr } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

export async function buildCoverageLoopProgress(payload = {}, { payloadPath = '', strictPython = false } = {}) {
  if (process.env.BILIBILI_COVERAGE_LOOP_USE_JS_PROGRESS === '1' && !strictPython) {
    return buildJsCoverageProgress(payload);
  }
  let tempDir = '';
  try {
    let progressPayloadPath = payloadPath;
    if (!progressPayloadPath) {
      tempDir = await mkdtemp(join(tmpdir(), 'coverage-loop-progress-'));
      progressPayloadPath = join(tempDir, 'payload.json');
      await writeFile(progressPayloadPath, JSON.stringify(payload, null, 2), 'utf8');
    }
    return await runPythonCoverageProgress(progressPayloadPath);
  } catch (error) {
    if (strictPython) throw error;
    return buildJsCoverageProgress(payload);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function buildAudit(options) {
  const dictionary = await readKeywordDictionary(options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {});
  const state = await readKeywordHarvestState(options.statePath);
  return buildDictionaryCoverageAudit(dictionary, state, options);
}

const dictionaryPath = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH;
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
import { DEFAULT_COVERAGE_LOOP_REPORT_PATH } from '../utils/paths.js';

const execFileAsync = promisify(execFile);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
const reportPath = process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH || DEFAULT_COVERAGE_LOOP_REPORT_PATH;
const maxCycles = nonNegativeIntFromEnv('BILIBILI_COVERAGE_LOOP_MAX_CYCLES', 3, 1000);
const roundsPerCycle = positiveIntFromEnv('BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE', positiveIntFromEnv('BILIBILI_HARVEST_ROUNDS', 1), 20);
const maxQueries = positiveIntFromEnv('BILIBILI_HARVEST_MAX_QUERIES', 12, 100);
const runtimeOptions = buildCoverageRuntimeOptions({ maxActionsFallback: maxQueries });
const targetEvidence = runtimeOptions.targetEvidence;
const maxActions = runtimeOptions.maxActions;
const minCoverageRatio = runtimeOptions.minCoverageRatio;
const requireComplete = runtimeOptions.requireComplete;
const requireSourceBackedEvidence = runtimeOptions.requireSourceBackedEvidence;
const requireCommentBackedEvidence = runtimeOptions.requireCommentBackedEvidence;
const existingTermsOnly = process.env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1';
const coverageMode = String(process.env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase();
const seedQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const controversyQueries = parseList(process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || process.env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
const extraQueryTemplates = parseList(process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
const exhaustedSuggestionTemplates = parseList(process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
const discoveryMode = String(process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase();
const discoveryLimit = positiveIntFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6, 20);
const discoveryPages = positiveIntFromEnv('BILIBILI_VIDEO_DISCOVERY_PAGES', 1, 5);
const controversialPopularQueryLimit = nonNegativeIntFromEnv('BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT', 4, 20);
const controversialPopularSearchOrder = String(process.env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click').trim().toLowerCase();
const includeGenericPopular = flagFromEnv('BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR', false);
const includeDanmaku = flagFromEnv('BILIBILI_HARVEST_INCLUDE_DANMAKU', false);
const pages = positiveIntFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2, 20);
const perQueryTimeoutMs = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_TIMEOUT_MS', 180000, 30 * 60 * 1000);
const queryVariantsPerTerm = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2, 20);
const termsPerFamily = positiveIntFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4, 20);
const retryBeforeUnattemptedLimit = runtimeOptions.retryBeforeUnattemptedLimit;
const maxHardMissedQueries = nonNegativeIntFromEnv('BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES', Math.max(2, Math.ceil(maxQueries / 2)), 100);
const staleMissedDiscoveryLimit = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT', 4, 20);
const staleMissedPages = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES', 3, 5);
const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';
const queryConcurrency = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_CONCURRENCY', 1, 16);
const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
// Corpus-mode knobs: let every scan (including priority-term scans) opportunistically
// match a large pool of weak dictionary terms in the same comment section, so one
// broad high-traffic scan can lift many terms at once instead of one term per query.
const commentPoolTargetTermsLimit = positiveIntFromEnv('BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT', 24, 200);
const priorityCommentPoolTargets = flagFromEnv('BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS', false);
const preFilterCommentsToTargets = flagFromEnv('BILIBILI_HARVEST_PREFILTER_COMMENTS', false);
const deepenReplyThreads = flagFromEnv('BILIBILI_HARVEST_DEEPEN_REPLIES', false);
const verbose = flagFromEnv('BILIBILI_HARVEST_VERBOSE', true);
const prioritizeNearTarget = flagFromEnv('BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET', false);
const pruneExhaustedAfter = nonNegativeIntFromEnv('BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER', 0, 100000);
const pruneIncludePartial = process.env.BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL === '1';
const strict = runtimeOptions.strict;
const expandTargetsFromComments = flagFromEnv('BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS', existingTermsOnly && requireCommentBackedEvidence);

const auditOptions = {
  dictionaryPath,
  statePath,
  targetEvidence,
  maxActions,
  minCoverageRatio,
  requireComplete,
  requireSourceBackedEvidence,
  requireCommentBackedEvidence,
  prioritizeSourceGaps: requireCommentBackedEvidence,
  prioritizeNearTarget,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
  retryBeforeUnattemptedLimit,
};

const planArgs = parsePlanArgs();
if (planArgs.planJson) {
  const payload = await readPlanPayload(planArgs.payloadPath);
  let tempDir = '';
  let planPayloadPath = planArgs.payloadPath;
  if (planArgs.pythonPlan) {
    if (!planPayloadPath) {
      tempDir = await mkdtemp(join(tmpdir(), 'coverage-loop-plan-'));
      planPayloadPath = join(tempDir, 'payload.json');
      await writeFile(planPayloadPath, JSON.stringify(payload, null, 2), 'utf8');
    }
    try {
      console.log(JSON.stringify(await runPythonCoverageLoopPlan(planPayloadPath), null, 2));
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  } else {
    console.log(JSON.stringify(buildCoverageHarvestLoopPlan(payload), null, 2));
  }
  process.exit(0);
}
if (planArgs.coverageProgressJson) {
  const payload = await readPlanPayload(planArgs.payloadPath);
  const progress = await buildCoverageLoopProgress(payload, { payloadPath: planArgs.payloadPath, strictPython: true });
  console.log(JSON.stringify(progress, null, 2));
  process.exit(0);
}
if (planArgs.pythonCommand || process.env.BILIBILI_COVERAGE_LOOP_USE_PYTHON_COMMAND === '1') {
  process.stdout.write(await runPythonCoverageLoopCommand({
    dictionaryPath,
    statePath,
    reportPath,
    maxCycles,
    roundsPerCycle,
    maxQueries,
    targetEvidence,
    maxActions,
    minCoverageRatio,
    requireComplete,
    requireSourceBackedEvidence,
    requireCommentBackedEvidence,
    includeDanmaku,
    resetState,
    skipSeen,
    stopOnNoProgress: process.env.BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS === '1',
    pruneExhaustedAfter,
    pruneIncludePartial,
    harvestCommandJson: process.env.BILIBILI_COVERAGE_LOOP_HARVEST_COMMAND_JSON || '',
    seedQueries,
    controversyQueries,
    discoveryMode,
    termsPerFamily,
    queryVariantsPerTerm,
    extraQueryTemplates,
    exhaustedSuggestionTemplates,
    discoveryLimit,
    discoveryPages,
    includeGenericPopular,
    maxHardMissedQueries,
    staleMissedDiscoveryLimit,
    staleMissedPages,
    coverageMode,
    commentPoolTargetTermsLimit,
    priorityCommentPoolTargets,
    preFilterCommentsToTargets,
    deepenReplyThreads,
    verbose,
    prioritizeNearTarget,
    existingTermsOnly,
    controversialPopularQueryLimit,
    controversialPopularSearchOrder,
    pages,
    perQueryTimeoutMs,
    expandTargetsFromComments,
    strict,
  }));
  process.exit(0);
}

const cycles = [];
let audit = await buildAudit(auditOptions);
let stopReason = audit.ok ? 'coverage_gate_passed' : maxCycles === 0 ? 'cycle_limit' : '';
console.log('Coverage harvest loop');
  if (!process.env.BILIBILI_COOKIE || !process.env.BILIBILI_COOKIE.trim()) {
    console.warn('[33m⚠ BILIBILI_COOKIE not set — authenticated requests get 5–10× higher rate limits. Set a logged-in session cookie for best throughput.[0m');
  }
console.log(`DeepSeek model: ${process.env.DEEPSEEK_MODEL}`);
console.log(`DeepSeek reasoning effort: ${process.env.DEEPSEEK_REASONING_EFFORT}`);
console.log(`Initial coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);

const cycleRetries = nonNegativeIntFromEnv('BILIBILI_COVERAGE_LOOP_CYCLE_RETRIES', 3, 10);
const maxConsecutiveFailures = positiveIntFromEnv('BILIBILI_COVERAGE_LOOP_MAX_CONSECUTIVE_FAILURES', 2, 10);
// Coverage checkpoint: snapshot dictionary+state to the coverage-checkpoints git
// branch every ~20 min so a power-loss (which can zero unflushed disk writes)
// never costs more than ~one cycle of progress. Piggybacks on cycle boundaries
// so it never interrupts a running query or adds lock contention.
const checkpointIntervalMs = positiveIntFromEnv('BILIBILI_COVERAGE_CHECKPOINT_INTERVAL_MS', 20 * 60 * 1000, 24 * 60 * 60 * 1000);
const checkpointDisabled = process.env.BILIBILI_COVERAGE_CHECKPOINT_DISABLE === '1';
const checkpointMaxSnapshots = positiveIntFromEnv('BILIBILI_COVERAGE_CHECKPOINT_MAX_SNAPSHOTS', 72, 1000);
let lastCheckpointAt = 0;
let checkpointsCreated = 0;
let cycle = 1;
let consecutiveFailures = 0;
let attemptsThisCycle = 0;
while (cycle <= maxCycles && !audit.ok) {
  try {
    const priorityQueries = priorityQueryItemsFromAudit(audit, maxQueries);
    // Fallback: when dictionary is fully covered, use seed queries for broad discovery
    if (priorityQueries.length === 0 && seedQueries.length > 0 && !audit.ok) {
      console.log(`No weak terms — using ${seedQueries.length} seed queries for discovery`);
      priorityQueries.push(...seedQueries.map((q, i) => ({
        query: q,
        priority: seedQueries.length - i,
        reason: 'seed_fallback',
        targetTerm: q,
        targetFamily: 'seed',
      })).slice(0, maxQueries));
    }
    if (priorityQueries.length === 0) {
      stopReason = 'no_recommended_queries';
      break;
    }
    console.log(`\nCycle ${cycle}/${maxCycles}`);
    console.log(`Priority queries: ${priorityQueries.length}`);
    for (const item of priorityQueries.slice(0, 8)) console.log(`- ${item.query}`);

    const harvest = await harvestKeywordDictionaryRounds({
    priorityQueries,
    seedQueries,
    controversyQueries,
    maxQueries,
    termsPerFamily,
    queryVariantsPerTerm,
    extraQueryTemplates,
    exhaustedSuggestionTemplates,
    retryBeforeUnattemptedLimit,
    maxHardMissedQueries,
    staleMissedDiscoveryLimit,
    staleMissedPages,
    targetEvidence,
    coverageMode,
    requireSourceBackedEvidence,
    requireCommentBackedEvidence,
    prioritizeSourceGaps: requireCommentBackedEvidence,
    commentPoolTargetTermsLimit,
    priorityCommentPoolTargets,
    preFilterCommentsToTargets,
    deepenReplyThreads,
    verbose,
    prioritizeNearTarget,
    existingTermsOnly,
    discoveryMode,
    discoveryLimit,
    discoveryPages,
    controversialPopularQueryLimit,
    controversialPopularSearchOrder,
    includeGenericPopular,
    includeDanmaku,
    pages,
    perQueryTimeoutMs,
    expandTargetsFromComments,
    rounds: roundsPerCycle,
    statePath,
    resetState: cycle === 1 ? resetState : false,
    skipSeen,
    queryConcurrency,
  });
  const nextAudit = await buildAudit(auditOptions);
  const executedQueries = harvest.rounds.flatMap((round) => round.queries);
  const harvestProgressItems = harvest.rounds.map((round) => round.coverageProgress);
  const progress = await buildCoverageLoopProgress({
    before: audit.coverage,
    after: nextAudit.coverage,
    harvestProgress: harvestProgressItems,
  });
  const delta = progress.harvestDelta;
  cycles.push({
    cycle,
    priorityQueries,
    harvest: {
      ok: harvest.ok,
      rounds: harvest.rounds.length,
      queries: executedQueries,
      warnings: harvest.rounds.flatMap((round) => round.warnings || []),
      coverageProgress: harvestProgressItems,
      trainingDiagnostics: harvest.rounds.map((round) => round.trainingDiagnostics),
      queryDiagnostics: harvest.rounds.map((round) => round.queryDiagnostics || []),
    },
    coverageDelta: delta,
    coverageBefore: audit.coverage,
    coverageAfter: nextAudit.coverage,
  });
  console.log(`Coverage after cycle: ${(nextAudit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${nextAudit.coverage.weakTerms}, zero ${nextAudit.coverage.zeroEvidenceTerms}`);
  console.log(
    `Delta: deficit -${delta.evidenceDeficitReduced}, zero -${delta.zeroEvidenceResolved}, weak -${delta.weakTermsResolved}, unsourced -${delta.unsourcedEvidenceReduced}, evidence +${delta.totalEvidenceGained}, terms +${delta.termsAdded}`,
  );
  if (executedQueries.length === 0) {
    stopReason = 'no_queries_run';
    audit = nextAudit;
    break;
  }
  if (
    !progress.hasHarvestProgress &&
    process.env.BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS === '1'
  ) {
    stopReason = 'no_coverage_progress';
    audit = nextAudit;
    break;
  }
  audit = nextAudit;

  // Prune-after-N-tries: after harvesting, drop terms that have been attempted enough
  // times and still cannot be attested, so coverage converges toward 100% honestly.
  if (pruneExhaustedAfter > 0) {
    const pruneDict = await readKeywordDictionary(dictionaryPath ? { dictionaryPath } : {});
    const pruneState = await readKeywordHarvestState(statePath);
    const exhausted = selectExhaustedTerms(pruneDict, pruneState, {
      targetEvidence,
      attemptThreshold: pruneExhaustedAfter,
      requireZeroEvidence: !pruneIncludePartial,
      requireSourceBackedEvidence,
      requireCommentBackedEvidence,
    });
    if (exhausted.length > 0) {
      const remove = new Set(exhausted.map((item) => item.term));
      const before = pruneDict.entries.length;
      pruneDict.entries = pruneDict.entries.filter((entry) => !remove.has(String(entry.term || '').trim()));
      // Write through writeSplitDictionaryAtomic (not bare writeJsonFileAtomic)
      // so the split-storage .entries/.evidence layout is preserved and each
      // shard write gets the fsync-durability treatment. Calling writeJsonFileAtomic
      // directly here previously overwrote the split manifest with a non-split
      // object, corrupting the layout.
      const pruneDictionaryPath = dictionaryPath || DEFAULT_DICTIONARY_PATH;
      pruneDict.updatedAt = new Date().toISOString();
      await writeSplitDictionaryAtomic(pruneDictionaryPath, pruneDict);
      console.log(`Pruned ${before - pruneDict.entries.length} exhausted term(s) (>=${pruneExhaustedAfter} attempts): ${before} -> ${pruneDict.entries.length}`);
      audit = await buildAudit(auditOptions);
      console.log(`Coverage after prune: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);
    }
  }
    // Coverage checkpoint: snapshot to the coverage-checkpoints git branch every
    // ~20 min (at cycle boundaries, so it never interrupts a running query). This
    // is the recovery medium if a power-loss zeros the live dictionary files —
    // the watchdog auto-restores the latest checkpoint on restart.
    if (
      !checkpointDisabled &&
      audit?.coverage &&
      (lastCheckpointAt === 0 || Date.now() - lastCheckpointAt >= checkpointIntervalMs)
    ) {
      try {
        const checkpoint = await createCoverageCheckpoint({
          meta: {
            coverageRatio: audit.coverage.coverageRatio,
            entries: audit.coverage.terms,
            weakTerms: audit.coverage.weakTerms,
          },
        });
        if (checkpoint.ok) {
          checkpointsCreated += 1;
          lastCheckpointAt = Date.now();
          console.log(`Coverage checkpoint: ${checkpoint.sha.slice(0, 8)} (ratio=${(audit.coverage.coverageRatio * 100).toFixed(2)}%, entries=${audit.coverage.terms}) -> coverage-checkpoints branch`);
          // Bound the branch history periodically (every ~10 checkpoints).
          if (checkpointsCreated % 10 === 0) {
            try {
              const pruned = await pruneOldCheckpoints({ maxSnapshots: checkpointMaxSnapshots });
              if (pruned.pruned > 0) console.log(`Checkpoint history pruned: dropped ${pruned.pruned} old snapshot(s), kept ${pruned.kept}`);
            } catch (pruneError) {
              console.warn(`Checkpoint prune skipped: ${pruneError?.code || 'unknown'}`);
            }
          }
        } else {
          console.warn(`Coverage checkpoint skipped: ${checkpoint.error}`);
        }
      } catch (checkpointError) {
        // Checkpoint failure must never abort the harvest cycle — it's best-effort.
        console.warn(`Coverage checkpoint failed (non-fatal): ${checkpointError?.code || 'unknown'}`);
      }
    }
    // Cycle body completed without throwing — reset failure tracking and advance.
    consecutiveFailures = 0;
    attemptsThisCycle = 0;
    cycle += 1;
  } catch (cycleError) {
    const transient = isTransientCoverageError(cycleError);
    attemptsThisCycle += 1;
    if (transient && attemptsThisCycle <= cycleRetries) {
      const wait = computeBackoffMs(attemptsThisCycle);
      console.warn(`\nCycle ${cycle} attempt ${attemptsThisCycle}/${cycleRetries} transient failure (${cycleError.code || cycleError.message || cycleError}) — backing off ${Math.round(wait / 1000)}s, retrying same cycle`);
      await sleep(wait);
      continue;
    }
    consecutiveFailures += 1;
    stopReason = transient ? `cycle_${cycle}_transient_exhausted` : `cycle_${cycle}_crashed`;
    console.error(`\nCycle ${cycle} ${transient ? 'exhausted transient retries' : 'crashed (fatal)'}: ${cycleError.stack || cycleError.message || cycleError}`);
    try {
      cycles.push({
        cycle,
        priorityQueries: [],
        harvest: { ok: false, rounds: 0, queries: [], warnings: [transient ? 'Cycle exhausted transient retries' : 'Harvest cycle failed unexpectedly'], coverageProgress: [], trainingDiagnostics: [], queryDiagnostics: [] },
        coverageDelta: null,
        coverageBefore: audit.coverage,
        coverageAfter: audit.coverage,
      });
    } catch {}
    if (consecutiveFailures >= maxConsecutiveFailures) {
      console.error(`${consecutiveFailures} consecutive failed cycles — stopping run (likely systemic: check API key / network / dictionary). Partial report saved.`);
      try {
        await writeJson(reportPath, { generatedAt: new Date().toISOString(), maxCycles, roundsPerCycle, stopReason, finalOk: false, finalAudit: audit, cycles });
      } catch (reportError) {
        console.error(`Failed to save crash report: ${reportError.message}`);
      }
      break;
    }
    // One-off failure: skip to the next cycle. State is checkpointed, so the next cycle
    // recomputes priority queries from the current audit — a single bad cycle must not
    // throw away a long unattended run.
    console.warn(`Skipping to cycle ${cycle + 1} after failure (consecutive ${consecutiveFailures}/${maxConsecutiveFailures}).`);
    attemptsThisCycle = 0;
    cycle += 1;
  }
}

if (!stopReason) stopReason = audit.ok ? 'coverage_gate_passed' : 'cycle_limit';

const report = {
  generatedAt: new Date().toISOString(),
  maxCycles,
  roundsPerCycle,
  stopReason,
  finalOk: audit.ok,
  finalAudit: audit,
  cycles,
};
await writeJson(reportPath, report);
console.log(`\nFinal coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%`);
console.log(`Weak terms: ${audit.coverage.weakTerms}`);
console.log(`Zero-evidence terms: ${audit.coverage.zeroEvidenceTerms}`);
console.log(`Stop reason: ${stopReason}`);
console.log(`Coverage loop report: ${reportPath}`);

// Final checkpoint at run end so the watchdog's next run resumes from the
// latest state even if the loop exits between scheduled checkpoints.
if (!checkpointDisabled && checkpointsCreated > 0) {
  try {
    const finalCheckpoint = await createCoverageCheckpoint({
      meta: { coverageRatio: audit.coverage.coverageRatio, entries: audit.coverage.terms, weakTerms: audit.coverage.weakTerms },
    });
    if (finalCheckpoint.ok) console.log(`Final coverage checkpoint: ${finalCheckpoint.sha.slice(0, 8)} -> coverage-checkpoints branch`);
  } catch (checkpointError) {
    console.warn(`Final checkpoint failed (non-fatal): ${checkpointError.message}`);
  }
}

if (strict && !audit.ok) {
  process.exitCode = 1;
}
}
