import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH,
  defaultBilibiliHistoryTagSeeds,
  mergeBilibiliHistoryTagCorpus,
} from '../services/bilibiliHistoryTags.js';

const execFileAsync = promisify(execFile);
const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const SUMMARY_KEYS = ['tags', 'videos', 'runs', 'corpusBvids', 'planRequestUrls'];

export const HISTORY_TAG_FIXTURES = {
  'merge-and-plan': {
    current: {
      version: 1,
      updatedAt: '2026-06-22T00:00:00.000Z',
      tags: [{ name: 'history', source: 'seed' }],
      videos: [{ bvid: 'BVoldhistory', aid: '100', title: 'old history', tags: ['history'], replyCount: 1 }],
      runs: [{ at: 'old-run' }],
    },
    update: {
      tags: [{ name: 'qing', source: 'seed' }],
      videos: [
        { bvid: 'BVoldhistory', aid: 100, title: '<em>old history</em>', tags: 'history,qing', replyCount: 9 },
        { bvid: 'BVnewhistory', aid: 200, title: '<em>new history</em>', tags: ['qing', 'history'], replyCount: 7 },
      ],
      runs: [{ at: 'new-run' }],
    },
    payload: {
      argv: ['--pages=2', '--page-size=3', '--seed=history', '--seed=qing'],
      env: { BILIBILI_HISTORY_TAG_WRITE: '1', BILIBILI_HISTORY_TAG_DELAY_MS: '0', BILIBILI_HISTORY_TAG_JITTER_MS: '0' },
    },
    expected: {
      tags: 2,
      videos: 2,
      runs: 2,
      corpusBvids: ['BVoldhistory', 'BVnewhistory'],
      planRequestUrls: [
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=history&page=1&page_size=3',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=history&page=2&page_size=3',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=qing&page=1&page_size=3',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=qing&page=2&page_size=3',
      ],
    },
  },
  'seed-file-plan': {
    current: { version: 1, updatedAt: null, tags: [], videos: [], runs: [] },
    update: {
      tags: [{ name: 'seed-file-history', source: 'seed' }],
      videos: [{ bvid: 'BVseedfile', aid: '300', title: 'seed file history', tags: ['seed-file-history'], replyCount: 3 }],
      runs: [{ at: 'seed-file-run' }],
    },
    payload: {
      argv: ['--output=server/data/customHistoryTags.json', '--seed=direct', '--seed-file=seeds.txt', '--pages=1', '--page-size=2'],
      env: { BILIBILI_HISTORY_TAG_SEEDS: 'envseed', BILIBILI_HISTORY_TAG_DELAY_MS: '10', BILIBILI_HISTORY_TAG_JITTER_MS: '5' },
      seedFiles: { 'seeds.txt': 'fileone\nfiletwo\nfileone' },
    },
    expected: {
      tags: 1,
      videos: 1,
      runs: 1,
      corpusBvids: ['BVseedfile'],
      planRequestUrls: [
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=envseed&page=1&page_size=2',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=direct&page=1&page_size=2',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=fileone&page=1&page_size=2',
        'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=filetwo&page=1&page_size=2',
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(HISTORY_TAG_FIXTURES);

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boundedInt(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(number), maximum));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function summarize(result = {}) {
  if (
    SUMMARY_KEYS.every((key) => key in result)
    && Array.isArray(result.corpusBvids)
    && Array.isArray(result.planRequestUrls)
  ) {
    return Object.fromEntries(SUMMARY_KEYS.map((key) => [key, result[key]]));
  }
  const corpus = result.corpus && typeof result.corpus === 'object' ? result.corpus : {};
  const plan = result.plan && typeof result.plan === 'object' ? result.plan : {};
  const videos = Array.isArray(corpus.videos) ? corpus.videos : [];
  const requests = Array.isArray(plan.requests) ? plan.requests : [];
  return {
    tags: Array.isArray(corpus.tags) ? corpus.tags.length : Number(result.tags) || 0,
    videos: videos.length || Number(result.videos) || 0,
    runs: Array.isArray(corpus.runs) ? corpus.runs.length : Number(result.runs) || 0,
    corpusBvids: videos.map((video) => video?.bvid).filter(Boolean),
    planRequestUrls: requests.map((request) => request?.url).filter(Boolean),
  };
}

export function compareBilibiliHistoryTagsObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function buildJsHistoryTagPlan(payload = {}) {
  const env = payload.env && typeof payload.env === 'object' ? payload.env : {};
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
  for (const rawArg of payload.argv || []) {
    const arg = String(rawArg || '');
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
  if (options.seedFile) options.seeds.push(...parseList(payload.seedFiles?.[options.seedFile]));
  options.seeds = uniqueStrings(options.seeds);
  if (!options.seeds.length) options.seeds = defaultBilibiliHistoryTagSeeds();
  const requests = options.seeds.flatMap((seed) => {
    const encoded = encodeURIComponent(seed);
    return Array.from({ length: options.pages }, (_, index) => {
      const page = index + 1;
      return {
        seed,
        page,
        url: `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encoded}&page=${page}&page_size=${options.pageSize}`,
        referer: `https://search.bilibili.com/all?keyword=${encoded}`,
      };
    });
  });
  return {
    ok: true,
    outputPath: options.outputPath,
    pages: options.pages,
    pageSize: options.pageSize,
    delayMs: options.delayMs,
    jitterMs: options.jitterMs,
    write: options.write,
    seeds: options.seeds,
    seedFile: options.seedFile,
    collectComments: false,
    collectDanmaku: false,
    requests,
    summary: { seeds: options.seeds.length, requests: requests.length, commentDanmakuScraping: false },
  };
}

async function runJsHistoryTags({ current, update, payload }) {
  return {
    ok: true,
    corpus: mergeBilibiliHistoryTagCorpus(current, update),
    plan: buildJsHistoryTagPlan(payload),
  };
}

async function runPythonHistoryTags({ currentPath, updatePath, payloadPath }) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const merge = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.history_tag_corpus',
      '--current',
      currentPath,
      '--update',
      updatePath,
      '--generated-at',
      GENERATED_AT,
    ],
    { cwd: process.cwd(), env, maxBuffer: 10 * 1024 * 1024 },
  );
  const plan = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.history_tag_corpus', '--plan-payload', payloadPath],
    { cwd: process.cwd(), env, maxBuffer: 10 * 1024 * 1024 },
  );
  const mergeResult = JSON.parse(merge.stdout);
  return { ok: true, corpus: mergeResult.corpus, plan: JSON.parse(plan.stdout) };
}

export async function compareBilibiliHistoryTags({
  current,
  update,
  payload,
  fixture,
  fixtureNames,
  runJs = runJsHistoryTags,
  runPython = runPythonHistoryTags,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareBilibiliHistoryTags({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? HISTORY_TAG_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'merge-and-plan';
  const resolvedCurrent = current || resolvedFixture?.current || HISTORY_TAG_FIXTURES['merge-and-plan'].current;
  const resolvedUpdate = update || resolvedFixture?.update || HISTORY_TAG_FIXTURES['merge-and-plan'].update;
  const resolvedPayload = payload || resolvedFixture?.payload || HISTORY_TAG_FIXTURES['merge-and-plan'].payload;
  const tempDir = await mkdtemp(join(tmpdir(), 'history-tags-compare-'));
  try {
    const currentPath = join(tempDir, 'current.json');
    const updatePath = join(tempDir, 'update.json');
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(currentPath, JSON.stringify(resolvedCurrent, null, 2), 'utf8');
    await writeFile(updatePath, JSON.stringify(resolvedUpdate, null, 2), 'utf8');
    await writeFile(payloadPath, JSON.stringify(resolvedPayload, null, 2), 'utf8');
    const context = {
      current: resolvedCurrent,
      currentPath,
      update: resolvedUpdate,
      updatePath,
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareBilibiliHistoryTagsObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, currentPath, updatePath, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareBilibiliHistoryTags({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
