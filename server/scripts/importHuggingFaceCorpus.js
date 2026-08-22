import { buildHuggingFaceCorpusUpdate, parseHuggingFaceRows } from '../services/huggingFaceCorpus.js';
import { readJsonCorpus, writeJsonCorpus } from '../services/splitCorpusStorage.js';
import { DEFAULT_HUGGINGFACE_CORPUS_PATH } from '../utils/paths.js';

const DEFAULT_SOURCES = [
  {
    dataset: 'Orphanage/Baidu_Tieba_SunXiaochuan',
    file: 'train.jsonl',
    platform: 'tieba',
    maxBytes: 750000,
    limit: 250,
  },
  {
    dataset: 'Orphanage/Baidu_Tieba_KangYaBeiGuo',
    file: 'data/tieba_post_detail_page_1~106/tieba_post_detail_page_1.json',
    platform: 'tieba',
    maxBytes: 750000,
    limit: 250,
  },
  {
    dataset: 'Midsummra/bilibilicomment',
    file: 'bilibili.csv',
    platform: 'bilibili',
    maxBytes: 5000000,
    limit: 1000,
  },
  {
    dataset: 'honeray/ai-music-comments-1.5M',
    file: 'final_data.csv',
    platform: 'bilibili',
    maxBytes: 1000000,
    limit: 250,
  },
  {
    dataset: 'wencan2024/bilibili-masterpieces',
    file: 'bilibili-masterpieces-v0.jsonl',
    platform: 'bilibili',
    maxBytes: 750000,
    limit: 100,
  },
  {
    dataset: 'JunyuLu/ToxiCN',
    file: 'ToxiCN_1.0.csv',
    platform: 'tieba',
    maxBytes: 1000000,
    limit: 250,
  },
];

function parseSource(value) {
  const [dataset, file, platform = 'huggingface', maxBytes = '750000', limit = '250', offset = '0'] = String(value || '').split('::');
  return {
    dataset: dataset?.trim(),
    file: file?.trim(),
    platform: platform?.trim(),
    maxBytes: Number(maxBytes),
    limit: Number(limit),
    offset: Number(offset),
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    outputPath: process.env.HUGGINGFACE_CORPUS_PATH || DEFAULT_HUGGINGFACE_CORPUS_PATH,
    sources: [],
    maxSources: Number(process.env.HUGGINGFACE_MAX_SOURCES || DEFAULT_SOURCES.length),
    requestTimeoutMs: Number(process.env.HUGGINGFACE_REQUEST_TIMEOUT_MS || 30000),
    write: process.env.HUGGINGFACE_CORPUS_WRITE === '1',
  };
  for (const arg of argv) {
    if (arg.startsWith('--output=')) options.outputPath = arg.slice('--output='.length).trim();
    else if (arg.startsWith('--source=')) options.sources.push(parseSource(arg.slice('--source='.length)));
    else if (arg.startsWith('--max-sources=')) options.maxSources = Number(arg.slice('--max-sources='.length));
    else if (arg.startsWith('--request-timeout-ms=')) options.requestTimeoutMs = Number(arg.slice('--request-timeout-ms='.length));
    else if (arg === '--write') options.write = true;
  }
  options.sources = (options.sources.length ? options.sources : DEFAULT_SOURCES)
    .filter((source) => source.dataset && source.file)
    .slice(0, Math.max(1, Math.min(Number(options.maxSources) || DEFAULT_SOURCES.length, 20)));
  options.requestTimeoutMs = Math.max(1000, Math.min(Number(options.requestTimeoutMs) || 30000, 120000));
  return options;
}

function datasetResolveUrl(source) {
  const encodedFile = String(source.file).split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/datasets/${source.dataset}/resolve/main/${encodedFile}`;
}

async function fetchSource(source, options = {}) {
  const maxBytes = Math.max(1000, Math.min(Number(source.maxBytes) || 750000, 5_000_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  try {
    const response = await fetch(datasetResolveUrl(source), {
      signal: controller.signal,
      headers: {
        Range: `bytes=0-${maxBytes - 1}`,
        'User-Agent': 'Bilibili_User_Personality corpus importer (bounded)',
      },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceWithRetry(source, options = {}) {
  const attempts = Math.max(1, Math.min(Number(options.fetchAttempts) || 3, 5));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchSource(source, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

const options = parseArgs();
const existing = await readJsonCorpus(options.outputPath, { version: 1, updatedAt: null, runs: [], comments: [] });
const run = {
  at: new Date().toISOString(),
  sources: options.sources.map((source) => ({
    dataset: source.dataset,
    file: source.file,
    platform: source.platform,
    maxBytes: source.maxBytes,
    limit: source.limit,
    offset: source.offset || 0,
  })),
  results: [],
};

console.log('Hugging Face corpus import');
console.log(`Sources: ${options.sources.length}`);
console.log(`Output: ${options.outputPath}`);
console.log(`Request timeout: ${options.requestTimeoutMs}ms`);

const imported = [];
for (const source of options.sources) {
  try {
    const raw = await fetchSourceWithRetry(source, options);
    const rows = parseHuggingFaceRows(raw, source);
    imported.push(...rows);
    run.results.push({ ...source, ok: true, rows: rows.length });
    console.log(`- ${source.dataset}/${source.file}: ${rows.length} row(s)`);
  } catch (error) {
    run.results.push({ ...source, ok: false, error: error?.message || String(error) });
    console.log(`- ${source.dataset}/${source.file}: failed (${error?.message || error})`);
  }
}

const update = buildHuggingFaceCorpusUpdate(existing, imported, run);
if (options.write && update.changed) {
  await writeJsonCorpus(options.outputPath, update.corpus);
} else if (!options.write) {
  console.log('Dry run only. Pass --write to update the corpus.');
} else {
  console.log('No new Hugging Face comments; corpus unchanged.');
}
console.log(`Imported rows: ${imported.length}`);
console.log(`Added comments: ${update.addedComments}`);
console.log(`Hugging Face comments in corpus: ${update.corpus.comments.length}`);
