import { readFile } from 'node:fs/promises';

import { fetchJson } from '../services/bilibiliCrawler.js';
import {
  DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH,
  defaultBilibiliHistoryTagSeeds,
  mergeBilibiliHistoryTagCorpus,
  readBilibiliHistoryTagCorpus,
  scrapeBilibiliHistoryTags,
  writeBilibiliHistoryTagCorpus,
} from '../services/bilibiliHistoryTags.js';

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readSeedFile(path) {
  if (!path) return [];
  return parseList(await readFile(path, 'utf8'));
}

async function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    outputPath: env.BILIBILI_HISTORY_TAG_CORPUS_PATH || DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH,
    pages: boundedInt(env.BILIBILI_HISTORY_TAG_PAGES, 1, 1, 10),
    pageSize: boundedInt(env.BILIBILI_HISTORY_TAG_PAGE_SIZE, 20, 1, 50),
    delayMs: boundedInt(env.BILIBILI_HISTORY_TAG_DELAY_MS, 5000, 0, 120000),
    jitterMs: boundedInt(env.BILIBILI_HISTORY_TAG_JITTER_MS, 2500, 0, 120000),
    seeds: parseList(env.BILIBILI_HISTORY_TAG_SEEDS),
    seedFile: env.BILIBILI_HISTORY_TAG_SEED_FILE || '',
    write: env.BILIBILI_HISTORY_TAG_WRITE === '1',
  };
  for (const arg of argv) {
    if (arg.startsWith('--output=')) options.outputPath = arg.slice('--output='.length).trim();
    else if (arg.startsWith('--pages=')) options.pages = boundedInt(arg.slice('--pages='.length), options.pages, 1, 10);
    else if (arg.startsWith('--page-size=')) options.pageSize = boundedInt(arg.slice('--page-size='.length), options.pageSize, 1, 50);
    else if (arg.startsWith('--delay-ms=')) options.delayMs = boundedInt(arg.slice('--delay-ms='.length), options.delayMs, 0, 120000);
    else if (arg.startsWith('--jitter-ms=')) options.jitterMs = boundedInt(arg.slice('--jitter-ms='.length), options.jitterMs, 0, 120000);
    else if (arg.startsWith('--seed=')) options.seeds.push(arg.slice('--seed='.length).trim());
    else if (arg.startsWith('--seeds=')) options.seeds.push(...parseList(arg.slice('--seeds='.length)));
    else if (arg.startsWith('--seed-file=')) options.seedFile = arg.slice('--seed-file='.length).trim();
    else if (arg === '--write') options.write = true;
  }
  options.seeds.push(...(await readSeedFile(options.seedFile)));
  options.seeds = [...new Set(options.seeds.filter(Boolean))];
  if (!options.seeds.length) options.seeds = defaultBilibiliHistoryTagSeeds();
  return options;
}

const options = await parseArgs();
console.log('Bilibili history tag library scrape');
console.log(`Seeds: ${options.seeds.length}`);
console.log(`Pages per seed: ${options.pages}`);
console.log(`Page size: ${options.pageSize}`);
console.log(`Delay: ${options.delayMs}ms + jitter ${options.jitterMs}ms`);
console.log('Comment/danmaku scraping: disabled for this command');

const scraped = await scrapeBilibiliHistoryTags(options, { fetchJson });
const current = await readBilibiliHistoryTagCorpus(options.outputPath);
const merged = mergeBilibiliHistoryTagCorpus(current, scraped);

console.log(`Videos found this run: ${scraped.videos.length}`);
console.log(`Corpus videos after merge: ${merged.videos.length}`);
console.log(`Warnings: ${scraped.warnings.length}`);
for (const warning of scraped.warnings.slice(0, 10)) console.log(`- ${warning}`);

if (options.write) {
  await writeBilibiliHistoryTagCorpus(options.outputPath, merged);
  console.log(`Wrote ${options.outputPath}`);
} else {
  console.log('Dry run only. Add --write to update the corpus.');
}
