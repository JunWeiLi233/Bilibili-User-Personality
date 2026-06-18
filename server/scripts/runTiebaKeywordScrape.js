import { readFile } from 'node:fs/promises';

import { buildTiebaCorpusUpdate } from '../services/tiebaCorpus.js';
import { computeTiebaScrapeHardStopMs } from '../services/tiebaScrapeTiming.js';
import { scrapeTiebaKeyword, scrapeTiebaThreadUrls } from '../services/tiebaScraper.js';
import { readJsonCorpus, writeJsonCorpus } from '../services/splitCorpusStorage.js';
import { DEFAULT_COVERAGE_ACTION_FILE_PATH, DEFAULT_TIEBA_CORPUS_PATH } from '../utils/paths.js';

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    queries: [],
    threadUrls: [],
    actionFile: DEFAULT_COVERAGE_ACTION_FILE_PATH,
    outputPath: process.env.TIEBA_CORPUS_PATH || DEFAULT_TIEBA_CORPUS_PATH,
    maxQueries: Number(process.env.TIEBA_MAX_QUERIES || 8),
    forumPages: Number(process.env.TIEBA_FORUM_PAGES || 1),
    threadLimit: Number(process.env.TIEBA_THREAD_LIMIT || 4),
    threadPages: Number(process.env.TIEBA_THREAD_PAGES || 1),
    minDelayMs: Number(process.env.TIEBA_SCRAPER_MIN_DELAY_MS || 5000),
    jitterMs: Number(process.env.TIEBA_SCRAPER_JITTER_MS || 3000),
    blockCooldownMs: Number(process.env.TIEBA_SCRAPER_BLOCK_COOLDOWN_MS || 120000),
    requestTimeoutMs: Number(process.env.TIEBA_SCRAPER_REQUEST_TIMEOUT_MS || 15000),
    overallTimeoutMs: Number(process.env.TIEBA_SCRAPER_OVERALL_TIMEOUT_MS || 30000),
    discoveryMode: process.env.TIEBA_DISCOVERY_MODE || 'desktop',
    includeDiscoveryTitles: process.env.TIEBA_INCLUDE_DISCOVERY_TITLES === '1',
    discoveryTitlesOnly: process.env.TIEBA_DISCOVERY_TITLES_ONLY === '1',
    train: process.env.TIEBA_TRAIN_DICTIONARY === '1',
    existingTermsOnly: process.env.TIEBA_EXISTING_TERMS_ONLY !== '0',
  };

  for (const arg of argv) {
    if (arg.startsWith('--query=')) options.queries.push(arg.slice('--query='.length).trim());
    else if (arg.startsWith('--queries=')) options.queries.push(...arg.slice('--queries='.length).split(/[,;|]/).map((item) => item.trim()));
    else if (arg.startsWith('--thread-url=')) options.threadUrls.push(arg.slice('--thread-url='.length).trim());
    else if (arg.startsWith('--thread-urls=')) {
      options.threadUrls.push(...arg.slice('--thread-urls='.length).split(/[,;|]/).map((item) => item.trim()));
    }
    else if (arg.startsWith('--actions=')) options.actionFile = arg.slice('--actions='.length).trim();
    else if (arg.startsWith('--output=')) options.outputPath = arg.slice('--output='.length).trim();
    else if (arg.startsWith('--max-queries=')) options.maxQueries = Number(arg.slice('--max-queries='.length));
    else if (arg.startsWith('--forum-pages=')) options.forumPages = Number(arg.slice('--forum-pages='.length));
    else if (arg.startsWith('--thread-limit=')) options.threadLimit = Number(arg.slice('--thread-limit='.length));
    else if (arg.startsWith('--thread-pages=')) options.threadPages = Number(arg.slice('--thread-pages='.length));
    else if (arg.startsWith('--min-delay-ms=')) options.minDelayMs = Number(arg.slice('--min-delay-ms='.length));
    else if (arg.startsWith('--jitter-ms=')) options.jitterMs = Number(arg.slice('--jitter-ms='.length));
    else if (arg.startsWith('--block-cooldown-ms=')) options.blockCooldownMs = Number(arg.slice('--block-cooldown-ms='.length));
    else if (arg.startsWith('--request-timeout-ms=')) options.requestTimeoutMs = Number(arg.slice('--request-timeout-ms='.length));
    else if (arg.startsWith('--overall-timeout-ms=')) options.overallTimeoutMs = Number(arg.slice('--overall-timeout-ms='.length));
    else if (arg.startsWith('--discovery-mode=')) options.discoveryMode = arg.slice('--discovery-mode='.length).trim();
    else if (arg === '--include-discovery-titles') options.includeDiscoveryTitles = true;
    else if (arg === '--discovery-titles-only') {
      options.discoveryTitlesOnly = true;
      options.includeDiscoveryTitles = true;
    }
    else if (arg === '--train') options.train = true;
    else if (arg === '--new-terms') options.existingTermsOnly = false;
    else if (arg && !arg.startsWith('--')) options.queries.push(arg.trim());
  }

  options.queries = [...new Set(options.queries.filter(Boolean))];
  options.threadUrls = [...new Set(options.threadUrls.filter(Boolean))];
  options.maxQueries = Math.max(1, Math.min(Number(options.maxQueries) || 8, 50));
  options.forumPages = Math.max(1, Math.min(Number(options.forumPages) || 1, 10));
  options.threadLimit = Math.max(1, Math.min(Number(options.threadLimit) || 4, 50));
  options.threadPages = Math.max(1, Math.min(Number(options.threadPages) || 1, 10));
  options.minDelayMs = boundedNumber(options.minDelayMs, 5000, 0, 60000);
  options.jitterMs = boundedNumber(options.jitterMs, 3000, 0, 60000);
  options.blockCooldownMs = boundedNumber(options.blockCooldownMs, 120000, 0, 300000);
  options.requestTimeoutMs = Math.max(1000, Math.min(Number(options.requestTimeoutMs) || 15000, 60000));
  options.overallTimeoutMs = Math.max(1000, Math.min(Number(options.overallTimeoutMs) || 30000, 120000));
  options.discoveryMode = ['desktop', 'mobile'].includes(String(options.discoveryMode).toLowerCase()) ? String(options.discoveryMode).toLowerCase() : 'desktop';
  return options;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

async function queriesFromActions(actionFile, maxQueries) {
  const actions = await readJson(actionFile, []);
  return [...new Set(
    (Array.isArray(actions) ? actions : [])
      .flatMap((item) => [item.query, item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])])
      .map((query) => String(query || '').trim())
      .filter(Boolean),
  )].slice(0, maxQueries);
}

async function loadExistingCorpus(path) {
  const corpus = await readJsonCorpus(path, null);
  if (corpus && Array.isArray(corpus.runs)) return corpus;
  return { version: 1, updatedAt: null, runs: [], comments: [] };
}

const options = parseArgs();
const hardStopMs = computeTiebaScrapeHardStopMs(options);
const hardStop = setTimeout(() => {
  console.error(`Tieba keyword scrape hard-stopped after ${hardStopMs}ms.`);
  process.exit(124);
}, hardStopMs);
if (typeof hardStop.unref === 'function') hardStop.unref();

if (options.queries.length === 0 && options.threadUrls.length === 0) {
  options.queries = await queriesFromActions(options.actionFile, options.maxQueries);
}
options.queries = options.queries.slice(0, options.maxQueries);

if (options.queries.length === 0 && options.threadUrls.length === 0) {
  console.log('No Tieba queries or thread URLs were provided and no coverage actions were available.');
  process.exit(0);
}

console.log('Tieba keyword corpus scrape');
console.log(`Queries: ${options.queries.length}`);
console.log(`Thread URLs: ${options.threadUrls.length}`);
console.log(`Limits: forumPages=${options.forumPages}, threadLimit=${options.threadLimit}, threadPages=${options.threadPages}`);
console.log(`Pacing: minDelay=${options.minDelayMs}ms, jitter=${options.jitterMs}ms, blockCooldown=${options.blockCooldownMs}ms`);
console.log(`Request timeout: ${options.requestTimeoutMs}ms`);
console.log(`Overall per-step timeout: ${options.overallTimeoutMs}ms`);
console.log(`Discovery mode: ${options.discoveryMode}`);
console.log(`Discovery title fallback: ${options.includeDiscoveryTitles ? 'enabled' : 'disabled'}`);
console.log(`Discovery titles only: ${options.discoveryTitlesOnly ? 'enabled' : 'disabled'}`);
console.log(`Output: ${options.outputPath}`);

const run = {
  at: new Date().toISOString(),
  queries: options.queries,
  threadUrls: options.threadUrls,
  results: [],
  warnings: [],
};

if (options.threadUrls.length > 0) {
  console.log('- explicit Tieba thread URLs');
  const result = await scrapeTiebaThreadUrls(options.threadUrls, {
    threadPages: options.threadPages,
    pages: options.threadPages,
    minDelayMs: options.minDelayMs,
    jitterMs: options.jitterMs,
    blockCooldownMs: options.blockCooldownMs,
    requestTimeoutMs: options.requestTimeoutMs,
    overallTimeoutMs: options.overallTimeoutMs,
    discoveryMode: options.discoveryMode,
    includeDiscoveryTitles: options.includeDiscoveryTitles,
    discoveryTitlesOnly: options.discoveryTitlesOnly,
  });
  console.log(`  threads=${result.threads.length} comments=${result.comments.length} warnings=${result.warnings.length}`);
  run.results.push({
    query: 'explicit Tieba thread URLs',
    ok: result.ok,
    threads: result.threads,
    comments: result.comments,
    warnings: result.warnings,
  });
  run.warnings.push(...result.warnings.map((warning) => `explicit Tieba thread URLs: ${warning}`));
}

for (const query of options.queries) {
  console.log(`- ${query}`);
  const result = await scrapeTiebaKeyword(query, {
    forumPages: options.forumPages,
    threadLimit: options.threadLimit,
    threadPages: options.threadPages,
    minDelayMs: options.minDelayMs,
    jitterMs: options.jitterMs,
    blockCooldownMs: options.blockCooldownMs,
    requestTimeoutMs: options.requestTimeoutMs,
    overallTimeoutMs: options.overallTimeoutMs,
    discoveryMode: options.discoveryMode,
    includeDiscoveryTitles: options.includeDiscoveryTitles,
    discoveryTitlesOnly: options.discoveryTitlesOnly,
  });
  console.log(`  threads=${result.threads.length} comments=${result.comments.length} warnings=${result.warnings.length}`);
  run.results.push({
    query,
    ok: result.ok,
    threads: result.threads,
    comments: result.comments,
    warnings: result.warnings,
  });
  run.warnings.push(...result.warnings.map((warning) => `${query}: ${warning}`));

  if (options.train && result.commentText.trim()) {
    const { trainKeywordDictionary } = await import('../services/deepseekKeywordTrainer.js');
    const training = await trainKeywordDictionary({
      uid: `tieba:${query}`,
      text: result.commentText,
      fullText: result.commentText,
      source: `Tieba public thread scan: ${result.threads.map((thread) => thread.sourceUrl).join(', ')}`,
      existingTermsOnly: options.existingTermsOnly,
    });
    console.log(`  dictionary entries accepted=${training.entries?.length || 0}`);
  }
}

const corpus = await loadExistingCorpus(options.outputPath);
const update = buildTiebaCorpusUpdate(corpus, run);
if (update.changed) {
  await writeJsonCorpus(options.outputPath, update.corpus);
} else {
  console.log('No new Tieba comments; corpus unchanged.');
}
console.log(`Tieba comments in corpus: ${update.corpus.comments.length}`);
clearTimeout(hardStop);
