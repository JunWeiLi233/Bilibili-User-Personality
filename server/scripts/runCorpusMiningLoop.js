#!/usr/bin/env node

/**
 * runCorpusMiningLoop.js — Corpus mining loop
 *
 * Orchestrates offline corpus mining and online Bilibili harvesting in a
 * unified loop until the dictionary coverage ratio reaches 1.0 (100%).
 *
 * Phases:
 *   0. Offline corpus mining — scan local comment corpora for weak dictionary
 *      terms and merge found evidence into the dictionary.
 *   1+. Online harvest loop — audit coverage, scrape Bilibili comments for
 *      remaining weak terms, re-audit, repeat until the coverage gate passes
 *      or the cycle limit is reached.
 *
 * Usage:
 *   node server/scripts/runCorpusMiningLoop.js
 *
 * Environment variables:
 *   CORPUS_MINING_ENABLED=0          — skip Phase 0 (default: 1)
 *   CORPUS_MINING_ACTION_FILE        — actions file for targeted mining
 *   LOCAL_BILIBILI_CORPUS_PATH       — explicit corpus paths (newline-sep)
 *   All runCoverageHarvestLoop.js env vars apply to Phase 1+.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { readKeywordDictionary, writeJsonFileAtomic, DEFAULT_DICTIONARY_PATH } from '../services/deepseekKeywordTrainer.js';
import { coverageDeltaFromHarvest, hasCoverageDeltaProgress } from '../utils/coverageProgress.js';
import { buildCoverageRuntimeOptions } from '../utils/coverageCliOptions.js';
import {
  buildDictionaryCoverageAudit,
  DEFAULT_HARVEST_STATE_PATH,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
  selectExhaustedTerms,
} from '../services/keywordHarvest.js';
import { runLocalCorpusEvidenceMining } from './mineLocalCorpusEvidence.js';
import { MODELS } from '../services/deepseekRouter.js';
import { DEFAULT_COVERAGE_LOOP_REPORT_PATH } from '../utils/paths.js';

const execFileAsync = promisify(execFile);

// ── Environment helpers ────────────────────────────────────

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

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload, null, 2)
    .replace(/[-￿]/g, (chr) => `\\u${chr.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await writeFile(path, `${json}\n`, 'utf8');
}

// ── JSON helpers ─────────────────────────────────────────────

function readJsonIfExists(path, fallback) {
  return readFile(path, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => fallback);
}

// ── Default corpus paths ────────────────────────────────────

const DEFAULT_CORPUS_PATHS = [
  'server/data/uid-discovery-comments.json',
  'server/data/bilibiliDirectProbeCorpus.json',
  'server/data/huggingFaceKeywordCorpus.json',
  'server/data/scoredCommentCorpus.json',
  'server/data/annotationCorpus.json',
  'server/data/bilibiliHistoryTagCorpus.json',
];

// ── Phase 0: Offline corpus mining ──────────────────────────
//
// Scans all available local comment corpora for occurrences of weak dictionary
// terms. Writes found evidence directly into the dictionary. This is a one-shot
// pass — re-running on static corpora yields nothing new, so it runs once
// before entering the online harvest loop.

async function runOfflineMining(options, log) {
  const corpusPaths = options.corpusPaths && options.corpusPaths.length
    ? options.corpusPaths
    : DEFAULT_CORPUS_PATHS;

  log('── Phase 0: Offline corpus mining (Python) ──');
  log(`Corpus files: ${corpusPaths.join(', ')}`);
  log(`Target evidence per term: ${options.targetEvidence}`);
  log(`Require comment-backed evidence: ${options.requireCommentBackedEvidence}`);

  const beforeDict = await readKeywordDictionary(
    options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {},
  );
  const beforeEntryCount = beforeDict.entries?.length || 0;
  const beforeWeakCount = beforeDict.entries
    ? beforeDict.entries.filter((e) => (e.evidenceCount || 0) < options.targetEvidence).length
    : 0;
  log(`Dictionary before: ${beforeEntryCount} entries, ${beforeWeakCount} weak`);

  // Use the fast Python miner instead of JS (Python handles string-heavy mining much faster)
  const args = ['-m', 'python_backend.cli.local_corpus_mine', '--write'];
  for (const cp of corpusPaths) {
    args.push('--corpus', cp);
  }
  log(`Running: python ${args.join(' ')}`);

  const { stdout, stderr } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 3600000,  // 1 hour for heavy corpus mining
  });
  if (stderr) process.stderr.write(stderr);

  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    log('Could not parse Python miner output — assuming no changes');
    result = { ok: true, entryCount: 0, corpusComments: 0, targetTerms: [] };
  }

  const afterDict = await readKeywordDictionary(
    options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {},
  );
  const afterEntryCount = afterDict.entries?.length || 0;
  const afterWeakCount = afterDict.entries
    ? afterDict.entries.filter((e) => (e.evidenceCount || 0) < options.targetEvidence).length
    : 0;

  log(`Mining complete: ${result.entryCount || 0} terms with evidence merged`);
  log(`Dictionary after: ${afterEntryCount} entries, ${afterWeakCount} weak`);
  log(`Net change: +${afterEntryCount - beforeEntryCount} entries, -${beforeWeakCount - afterWeakCount} weak`);

  return {
    ok: result.ok !== false,
    corpusFiles: corpusPaths,
    corpusComments: result.corpusComments || 0,
    targetTerms: result.targetTerms || [],
    entryCount: result.entryCount || 0,
    dictionaryBefore: beforeEntryCount,
    dictionaryAfter: afterEntryCount,
    weakBefore: beforeWeakCount,
    weakAfter: afterWeakCount,
    writeAttempted: result.write !== false,
  };
}

// ── Phase 1+: Online harvest loop ───────────────────────────
//
// After offline mining, remaining weak terms require live Bilibili scraping.
// This phase mirrors the structure of runCoverageHarvestLoop.js: audit →
// build priority queries → harvest → re-audit → check progress → repeat.
// It reuses the same service functions so behavior is identical.

async function buildAudit(options) {
  const dictionary = await readKeywordDictionary(
    options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {},
  );
  const state = await readKeywordHarvestState(options.statePath);
  return buildDictionaryCoverageAudit(dictionary, state, options);
}

// ── Main entry ──────────────────────────────────────────────

const CORPUS_MINING_REPORT_PATH = process.env.CORPUS_MINING_REPORT_PATH
  || join(process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH
    ? dirname(process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH)
    : dirname(DEFAULT_COVERAGE_LOOP_REPORT_PATH),
  'keywordCorpusMiningLoopReport.json');

async function main() {
  // ── Model config ─────────────────────────────────────────
  process.env.DEEPSEEK_MODEL = process.env.BILIBILI_HARVEST_MODEL || MODELS.V4_FLASH;
  process.env.DEEPSEEK_REASONING_EFFORT = process.env.BILIBILI_HARVEST_REASONING_EFFORT || 'max';

  // ── Harvest loop params ──────────────────────────────────
  const reportPath = process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH || DEFAULT_COVERAGE_LOOP_REPORT_PATH;
  const maxCycles = nonNegativeIntFromEnv('BILIBILI_COVERAGE_LOOP_MAX_CYCLES', 10, 50);
  const roundsPerCycle = positiveIntFromEnv('BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE',
    positiveIntFromEnv('BILIBILI_HARVEST_ROUNDS', 1), 20);
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
  const maxHardMissedQueries = nonNegativeIntFromEnv('BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES',
    Math.max(2, Math.ceil(maxQueries / 2)), 100);
  const staleMissedDiscoveryLimit = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT', 4, 20);
  const staleMissedPages = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES', 3, 5);
  const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';
  const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
  const commentPoolTargetTermsLimit = positiveIntFromEnv('BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT', 24, 200);
  const priorityCommentPoolTargets = flagFromEnv('BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS', false);
  const preFilterCommentsToTargets = flagFromEnv('BILIBILI_HARVEST_PREFILTER_COMMENTS', false);
  const deepenReplyThreads = flagFromEnv('BILIBILI_HARVEST_DEEPEN_REPLIES', false);
  const verbose = flagFromEnv('BILIBILI_HARVEST_VERBOSE', true);
  const prioritizeNearTarget = flagFromEnv('BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET', false);
  const pruneExhaustedAfter = nonNegativeIntFromEnv('BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER', 0, 100000);
  const pruneIncludePartial = process.env.BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL === '1';
  const strict = runtimeOptions.strict;
  const expandTargetsFromComments = flagFromEnv('BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS',
    existingTermsOnly && requireCommentBackedEvidence);
  const stopOnNoProgress = flagFromEnv('BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS', false);

  // ── Mining phase params ──────────────────────────────────
  const miningEnabled = flagFromEnv('CORPUS_MINING_ENABLED', true);
  const miningActionFile = process.env.CORPUS_MINING_ACTION_FILE || '';
  const miningCorpusPaths = parseList(process.env.LOCAL_BILIBILI_CORPUS_PATH);

  const dictionaryPath = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH;
  const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;

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

  const log = console.log;

  log('╔══════════════════════════════════════════════════════════════╗');
  log('║        Corpus Mining Loop                                   ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log(`DeepSeek model: ${process.env.DEEPSEEK_MODEL}`);
  log(`DeepSeek reasoning effort: ${process.env.DEEPSEEK_REASONING_EFFORT}`);
  log(`Coverage mode: ${coverageMode}`);
  log(`Target evidence per term: ${targetEvidence}`);
  log(`Max harvest cycles: ${maxCycles}`);
  log(`Rounds per cycle: ${roundsPerCycle}`);
  log(`Max harvest queries per cycle: ${maxQueries}`);
  log(`Offline corpus mining: ${miningEnabled ? 'enabled' : 'disabled'}`);
  log('');

  const cycles = [];
  let miningResult = null;
  let stopReason = '';

  // ── Phase 0: Offline corpus mining ───────────────────────
  if (miningEnabled) {
    miningResult = await runOfflineMining({
      targetEvidence,
      requireCommentBackedEvidence,
      corpusPaths: miningCorpusPaths,
      actionFile: miningActionFile,
      dictionaryPath,
    }, log);

    // Audit after mining
    let audit = await buildAudit(auditOptions);
    log(`\nCoverage after offline mining: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%,` +
      ` weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);

    if (audit.ok) {
      stopReason = 'coverage_gate_passed_after_mining';
      log('\n✓ Coverage gate passed after offline mining! No harvest needed.');
      const finalReport = {
        generatedAt: new Date().toISOString(),
        miningResult,
        finalOk: true,
        stopReason,
        finalAudit: audit,
        cycles: [],
      };
      await writeJson(CORPUS_MINING_REPORT_PATH, finalReport);
      log(`\nCorpus mining loop report: ${CORPUS_MINING_REPORT_PATH}`);
      if (strict && !audit.ok) process.exitCode = 1;
      return;
    }
  }

  // ── Phase 1+: Online harvest loop ────────────────────────
  let audit = await buildAudit(auditOptions);
  log(`\n── Phase 1+: Online harvest loop ──`);
  log(`Initial coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%,` +
    ` weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);
  log(`Evidence deficit: ${audit.coverage.evidenceDeficit}`);

  for (let cycle = 1; cycle <= maxCycles && !audit.ok; cycle += 1) {
    try {
      const priorityQueries = priorityQueryItemsFromAudit(audit, maxQueries);
      if (priorityQueries.length === 0) {
        stopReason = 'no_recommended_queries';
        log('\nNo recommended queries from audit — stopping.');
        break;
      }

      log(`\n── Cycle ${cycle}/${maxCycles} ──`);
      log(`Priority queries: ${priorityQueries.length}`);
      for (const item of priorityQueries.slice(0, 8)) {
        log(`  - ${item.query}`);
      }

      // ── Harvest ─────────────────────────────────────────
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
      });

      const nextAudit = await buildAudit(auditOptions);
      const executedQueries = harvest.rounds.flatMap((round) => round.queries);
      const harvestProgressItems = harvest.rounds.map((round) => round.coverageProgress);
      const delta = coverageDeltaFromHarvest(audit.coverage, nextAudit.coverage, harvestProgressItems);

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

      log(`Coverage after cycle: ${(nextAudit.coverage.coverageRatio * 100).toFixed(2)}%,` +
        ` weak ${nextAudit.coverage.weakTerms}, zero ${nextAudit.coverage.zeroEvidenceTerms}`);
      log(`Delta: deficit -${delta.evidenceDeficitReduced},` +
        ` zero -${delta.zeroEvidenceResolved},` +
        ` weak -${delta.weakTermsResolved},` +
        ` evidence +${delta.totalEvidenceGained}`);

      if (executedQueries.length === 0) {
        stopReason = 'no_queries_run';
        audit = nextAudit;
        break;
      }

      if (!hasCoverageDeltaProgress(delta) && stopOnNoProgress) {
        stopReason = 'no_coverage_progress';
        audit = nextAudit;
        log('No coverage progress detected — stopping (stop-on-no-progress).');
        break;
      }

      audit = nextAudit;

      // ── Prune exhausted terms ───────────────────────────
      if (pruneExhaustedAfter > 0) {
        const pruneDict = await readKeywordDictionary(
          dictionaryPath ? { dictionaryPath } : {},
        );
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
          pruneDict.entries = pruneDict.entries.filter(
            (entry) => !remove.has(String(entry.term || '').trim()),
          );
          await writeJsonFileAtomic(dictionaryPath || DEFAULT_DICTIONARY_PATH, pruneDict);
          log(`Pruned ${before - pruneDict.entries.length} exhausted term(s)` +
            ` (>=${pruneExhaustedAfter} attempts): ${before} → ${pruneDict.entries.length}`);
          audit = await buildAudit(auditOptions);
          log(`Coverage after prune: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%,` +
            ` weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);
        }
      }
    } catch (cycleError) {
      log(`\nCycle ${cycle} crashed: ${cycleError.message}`);
      log(cycleError.stack);
      stopReason = `cycle_${cycle}_crashed`;
      try {
        cycles.push({
          cycle,
          priorityQueries: [],
          harvest: {
            ok: false,
            rounds: 0,
            queries: [],
            warnings: [cycleError.message],
            coverageProgress: [],
            trainingDiagnostics: [],
            queryDiagnostics: [],
          },
          coverageDelta: null,
          coverageBefore: audit.coverage,
          coverageAfter: audit.coverage,
        });
      } catch (_) { /* best-effort */ }
      break;
    }
  }

  if (!stopReason) {
    stopReason = audit.ok ? 'coverage_gate_passed' : 'cycle_limit';
  }

  const report = {
    generatedAt: new Date().toISOString(),
    miningResult,
    maxCycles,
    roundsPerCycle,
    stopReason,
    finalOk: audit.ok,
    finalAudit: audit,
    cycles,
  };

  await writeJson(CORPUS_MINING_REPORT_PATH, report);

  log(`\n╔══════════════════════════════════════════════════════════════╗`);
  log(`║  Corpus Mining Loop Complete                                 ║`);
  log(`╚══════════════════════════════════════════════════════════════╝`);
  log(`Final coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%`);
  log(`Weak terms: ${audit.coverage.weakTerms}`);
  log(`Zero-evidence terms: ${audit.coverage.zeroEvidenceTerms}`);
  log(`Evidence deficit: ${audit.coverage.evidenceDeficit}`);
  log(`Cycles completed: ${cycles.length}`);
  log(`Stop reason: ${stopReason}`);
  log(`Report: ${CORPUS_MINING_REPORT_PATH}`);

  if (strict && !audit.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
