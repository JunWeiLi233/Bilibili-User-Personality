import { readKeywordDictionary, writeJsonFileAtomic, DEFAULT_DICTIONARY_PATH } from '../services/deepseekKeywordTrainer.js';
import { DEFAULT_HARVEST_STATE_PATH, readKeywordHarvestState, selectExhaustedTerms } from '../services/keywordHarvest.js';
import { buildCoverageRuntimeOptions } from '../utils/coverageCliOptions.js';
import { fileURLToPath } from 'node:url';

// Prune-after-N-tries curation: remove dictionary terms that have been harvested
// at least BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER times and still cannot be attested
// in public comments. Keeps real slang that just needs more crawling; lets coverage
// converge toward 100% honestly over sustained harvest runs.

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    dictionaryPath: process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH || DEFAULT_DICTIONARY_PATH,
    statePath: process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH,
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
    }
  }
  return options;
}

function planSummary({ exhausted, attemptThreshold, requireZeroEvidence }) {
  return {
    ok: true,
    count: exhausted.length,
    candidates: exhausted,
    summary: {
      attemptThreshold,
      requireZeroEvidence,
      candidates: exhausted.length,
    },
  };
}

export async function runPruneExhaustedTerms(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runtime = buildCoverageRuntimeOptions({ maxActionsFallback: 20 });
  const attemptThreshold = Math.max(1, Number(process.env.BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER || 10));
  const requireZeroEvidence = process.env.BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL !== '1';
  const apply = process.env.BILIBILI_HARVEST_PRUNE_APPLY === '1';
  const dictionary = await readKeywordDictionary({ dictionaryPath: options.dictionaryPath });
  const state = await readKeywordHarvestState(options.statePath);
  const exhausted = selectExhaustedTerms(dictionary, state, {
    targetEvidence: runtime.targetEvidence,
    attemptThreshold,
    requireZeroEvidence,
    requireSourceBackedEvidence: runtime.requireSourceBackedEvidence,
    requireCommentBackedEvidence: runtime.requireCommentBackedEvidence,
  });
  const result = {
    ...planSummary({ exhausted, attemptThreshold, requireZeroEvidence }),
    dictionaryPath: options.dictionaryPath,
    statePath: options.statePath,
    targetEvidence: runtime.targetEvidence,
    requireSourceBackedEvidence: runtime.requireSourceBackedEvidence,
    requireCommentBackedEvidence: runtime.requireCommentBackedEvidence,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(`Exhausted-term prune (>= ${attemptThreshold} attempts, ${requireZeroEvidence ? 'zero-evidence only' : 'any below target'})`);
  console.log(`Candidates: ${exhausted.length}`);
  for (const item of exhausted.slice(0, 40)) console.log(`- [${item.family}] ${item.term} (attempts ${item.attempts}, evidence ${item.evidence})`);

  if (!apply) {
    console.log('\nDry run. Set BILIBILI_HARVEST_PRUNE_APPLY=1 to remove these terms.');
  } else if (exhausted.length > 0) {
    const remove = new Set(exhausted.map((item) => item.term));
    const before = dictionary.entries.length;
    dictionary.entries = dictionary.entries.filter((entry) => !remove.has(String(entry.term || '').trim()));
    await writeJsonFileAtomic(options.dictionaryPath, dictionary);
    console.log(`\nPruned ${before - dictionary.entries.length} exhausted term(s): ${before} -> ${dictionary.entries.length}`);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPruneExhaustedTerms().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
