import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { harvestKeywordDictionaryRounds as defaultHarvestKeywordDictionaryRounds } from '../services/keywordHarvest.js';

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function boolValue(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function buildHarvestOptions(request = {}) {
  const options = request.options && typeof request.options === 'object' ? request.options : {};
  return {
    dictionaryPath: request.dictionaryPath || options.dictionaryPath,
    statePath: request.statePath || options.statePath,
    priorityQueries: Array.isArray(request.priorityQueries) ? request.priorityQueries : [],
    rounds: positiveNumber(options.rounds, 1),
    maxQueries: positiveNumber(options.maxQueries, 12),
    targetEvidence: positiveNumber(options.targetEvidence, 3),
    maxActions: positiveNumber(options.maxActions, positiveNumber(options.maxQueries, 12)),
    minCoverageRatio: Number.isFinite(Number(options.minCoverageRatio)) ? Number(options.minCoverageRatio) : 1,
    requireComplete: boolValue(options.requireComplete, true),
    requireSourceBackedEvidence: boolValue(options.requireSourceBackedEvidence, false),
    requireCommentBackedEvidence: boolValue(options.requireCommentBackedEvidence, false),
    includeDanmaku: boolValue(options.includeDanmaku, false),
    resetState: boolValue(options.resetState, false),
    skipSeen: boolValue(options.skipSeen, true),
    seedQueries: Array.isArray(options.seedQueries) ? options.seedQueries : [],
    controversyQueries: Array.isArray(options.controversyQueries) ? options.controversyQueries : [],
    discoveryMode: String(options.discoveryMode || 'controversial').trim().toLowerCase(),
    includeGenericPopular: boolValue(options.includeGenericPopular, false),
    pages: positiveNumber(options.pages, 2),
    perQueryTimeoutMs: positiveNumber(options.perQueryTimeoutMs, 180000),
    expandTargetsFromComments: boolValue(options.expandTargetsFromComments, false),
  };
}

export async function runCoverageLoopJsHarvestAdapter(request = {}, deps = {}) {
  const harvestKeywordDictionaryRounds = deps.harvestKeywordDictionaryRounds || defaultHarvestKeywordDictionaryRounds;
  const options = buildHarvestOptions(request);
  const result = await harvestKeywordDictionaryRounds(options);
  return {
    ok: result?.ok === true,
    afterDictionary: result?.dictionary && typeof result.dictionary === 'object' ? result.dictionary : null,
    harvest: {
      ok: result?.ok === true,
      rounds: Array.isArray(result?.rounds) ? result.rounds : [],
    },
  };
}

async function main() {
  const payloadPath = process.argv[2] || '';
  const payload = payloadPath ? JSON.parse(await readFile(payloadPath, 'utf8')) : {};
  const mockResultIndex = process.argv.indexOf('--mock-result');
  if (mockResultIndex !== -1 && process.argv[mockResultIndex + 1]) {
    const mockResult = JSON.parse(await readFile(process.argv[mockResultIndex + 1], 'utf8'));
    console.log(JSON.stringify(mockResult, null, 2));
    return;
  }
  const result = await runCoverageLoopJsHarvestAdapter(payload);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
