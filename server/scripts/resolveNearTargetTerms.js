import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { buildDictionaryCoverageAudit, readKeywordHarvestState } from '../services/keywordHarvest.js';
import { searchVideoKeywords } from '../services/videoKeywordSearch.js';
import { fileURLToPath } from 'node:url';

// Targeted resolver: a term that is one or two evidences short already appeared in
// specific videos. Re-scanning those exact videos with reply-tree deepening is the
// highest-yield way to reach the 3-evidence target, since the term is known to occur
// there. Processes a batch of near-target terms per run (bounded for sandbox limits).

const targetEvidence = 3;

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    dictionaryPath: process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH || '',
    statePath: process.env.BILIBILI_HARVEST_STATE_PATH || '',
    maxNeed: Math.max(1, Number(process.env.RESOLVE_MAX_NEED || 1)),
    batch: Math.max(1, Number(process.env.RESOLVE_BATCH || 12)),
    videosPerTerm: Math.max(1, Number(process.env.RESOLVE_VIDEOS_PER_TERM || 3)),
    pages: Math.max(1, Number(process.env.RESOLVE_PAGES || 3)),
    overrideTerms: parseList(process.env.RESOLVE_OVERRIDE_TERMS),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--dictionary') {
      options.dictionaryPath = argv[index + 1] || options.dictionaryPath;
      index += 1;
    } else if (arg.startsWith('--dictionary=')) {
      options.dictionaryPath = arg.slice('--dictionary='.length) || options.dictionaryPath;
    } else if (arg === '--state') {
      options.statePath = argv[index + 1] || options.statePath;
      index += 1;
    } else if (arg.startsWith('--state=')) {
      options.statePath = arg.slice('--state='.length) || options.statePath;
    } else if (arg === '--max-need') {
      options.maxNeed = Math.max(1, Number(argv[index + 1] || options.maxNeed));
      index += 1;
    } else if (arg.startsWith('--max-need=')) {
      options.maxNeed = Math.max(1, Number(arg.slice('--max-need='.length) || options.maxNeed));
    } else if (arg === '--batch') {
      options.batch = Math.max(1, Number(argv[index + 1] || options.batch));
      index += 1;
    } else if (arg.startsWith('--batch=')) {
      options.batch = Math.max(1, Number(arg.slice('--batch='.length) || options.batch));
    } else if (arg === '--videos-per-term') {
      options.videosPerTerm = Math.max(1, Number(argv[index + 1] || options.videosPerTerm));
      index += 1;
    } else if (arg.startsWith('--videos-per-term=')) {
      options.videosPerTerm = Math.max(1, Number(arg.slice('--videos-per-term='.length) || options.videosPerTerm));
    } else if (arg === '--pages') {
      options.pages = Math.max(1, Number(argv[index + 1] || options.pages));
      index += 1;
    } else if (arg.startsWith('--pages=')) {
      options.pages = Math.max(1, Number(arg.slice('--pages='.length) || options.pages));
    } else if (arg === '--override-terms') {
      options.overrideTerms = parseList(argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--override-terms=')) {
      options.overrideTerms = parseList(arg.slice('--override-terms='.length));
    }
  }
  return options;
}

const bvidRe = /(BV[0-9A-Za-z]{8,})/g;

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function evidenceNeededFor(entry) {
  const count = Number(entry?.evidenceCount);
  if (Number.isFinite(count)) return Math.max(0, targetEvidence - count);
  const samples = Array.isArray(entry?.evidenceSamples) ? entry.evidenceSamples.length : 0;
  return Math.max(0, targetEvidence - samples);
}

export function buildResolveNearTargetPlan(dict, state, options = {}) {
  const maxNeed = Math.max(1, Number(options.maxNeed || 1));
  const batch = Math.max(1, Number(options.batch || 12));
  const videosPerTerm = Math.max(1, Number(options.videosPerTerm || 3));
  const pages = Math.max(1, Number(options.pages || 3));
  const overrideTerms = Array.isArray(options.overrideTerms) ? options.overrideTerms : [];
  const audit = buildDictionaryCoverageAudit(dict, state, {
    targetEvidence,
    maxActions: 5000,
    requireSourceBackedEvidence: true,
    requireCommentBackedEvidence: true,
    minCoverageRatio: 1,
    requireComplete: true,
  });
  const byTerm = new Map((dict.entries || []).map((entry) => [String(entry.term || ''), entry]));
  const targets = overrideTerms.length > 0
    ? overrideTerms.filter((term) => byTerm.has(term))
    : unique((audit.nextActions || [])
        .filter((action) => action.evidenceNeeded >= 1 && action.evidenceNeeded <= maxNeed)
        .map((action) => String(action.term || '')))
        .filter((term) => byTerm.has(term));
  const poolNeedles = targets.slice(0, 200);
  const plans = [];
  const skipped = [];
  for (const term of targets.slice(0, batch)) {
    const entry = byTerm.get(term) || {};
    const txt = JSON.stringify(entry.evidenceSources || []);
    const bvids = unique([...txt.matchAll(bvidRe)].map((match) => match[1])).slice(0, videosPerTerm);
    if (bvids.length === 0) {
      skipped.push({ term, reason: 'no_source_bvids' });
      continue;
    }
    plans.push({
      term,
      family: entry.family || '',
      evidenceNeeded: evidenceNeededFor(entry),
      bvids,
      pages,
      targetExistingTerms: unique([term, ...poolNeedles]),
    });
  }
  const videosPlanned = plans.reduce((total, plan) => total + plan.bvids.length, 0);
  return {
    ok: true,
    targetEvidence,
    maxNeed,
    batch,
    videosPerTerm,
    pages,
    candidateCount: targets.length,
    candidateTerms: targets,
    plannedCount: plans.length,
    videosPlanned,
    plans,
    skipped,
    summary: { candidateCount: targets.length, plannedCount: plans.length, videosPlanned },
  };
}

export async function runResolveNearTargetTerms(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const dict = await readKeywordDictionary(options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {});
  const state = await readKeywordHarvestState(options.statePath || undefined);
  const plan = buildResolveNearTargetPlan(dict, state, options);
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return plan;
  }

  let processed = 0;
  let scanned = 0;
  console.log(`Near-target resolver: ${plan.candidateCount} candidate terms (need<=${plan.maxNeed}); processing ${plan.plans.length + plan.skipped.length}`);
  for (const item of plan.skipped) console.log(`  [skip] ${item.term}: no source BVIDs`);
  for (const item of plan.plans) {
    try {
      const result = await searchVideoKeywords({
        videoLinks: item.bvids,
        pages: item.pages,
        existingTermsOnly: true,
        preFilterCommentsToTargets: true,
        deepenReplyThreads: true,
        deepenRootLimit: 10,
        deepenPages: 3,
        includeDanmaku: true,
        expandTargetsFromComments: true,
        targetExistingTerms: item.targetExistingTerms,
      });
      const diagnostics = result.collectionDiagnostics || {};
      const accepted = Array.isArray(diagnostics.acceptedTerms) ? diagnostics.acceptedTerms.length : 0;
      scanned += item.bvids.length;
      processed += 1;
      console.log(`  [${processed}/${plan.plannedCount}] ${item.term}: videos=${item.bvids.length} comments=${diagnostics.commentsCollected || 0} accepted=${accepted}`);
    } catch (error) {
      console.log(`  [err] ${item.term}: ${error.message}`);
    }
  }
  console.log(`Done. processed=${processed} videos-scanned=${scanned}`);
  return { ...plan, processed, scanned };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runResolveNearTargetTerms().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
