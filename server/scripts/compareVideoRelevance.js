import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  filterRelevantVideos,
  relevanceScoreForVideo,
  searchNeedlesForRelevance,
  sortVideosByRelevance,
} from '../services/videoKeywordSearch.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['operation', 'needles', 'videos', 'scores'];

export const VIDEO_RELEVANCE_FIXTURES = {
  'alias-sort': {
    payload: {
      operation: 'sort',
      videos: [
        { bvid: 'BV0', title: '路过视频' },
        { bvid: 'BV1', title: '宝宝争议' },
        { bvid: 'BV2', title: '中国宝宝体质名场面' },
        { bvid: 'BV3', title: '宝宝 宝宝' },
      ],
      searchQueries: ['宝宝 评论区'],
      targetExistingTerms: ['中国宝宝体质'],
    },
  },
  'ask-baidu-filter': {
    payload: {
      operation: 'filter',
      videos: [
        { bvid: 'BV1', title: '百度这个梗怎么用' },
        { bvid: 'BV2', title: '百度网盘资源分享' },
      ],
      searchQueries: ['百度'],
      targetExistingTerms: ['问百度'],
    },
  },
  'strict-target-filter': {
    payload: {
      operation: 'filter',
      videos: [
        { bvid: 'BV3', title: '宅男联盟 切片' },
        { bvid: 'BV4', title: '国际新闻 评论区' },
      ],
      searchQueries: ['国际 评论区'],
      targetExistingTerms: ['宅男联盟'],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(VIDEO_RELEVANCE_FIXTURES);

function videoId(video) {
  if (!video || typeof video !== 'object') return video;
  return video.bvid || video.aid || video.id || video;
}

function normalizeValue(value) {
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object')) {
    if (value.every((item) => 'video' in item && 'score' in item)) {
      return value.map((item) => ({ bvid: videoId(item.video), score: item.score }));
    }
    if (value.every((item) => 'bvid' in item || 'aid' in item || 'id' in item)) {
      return value.map(videoId);
    }
  }
  return value;
}

function summarize(result = {}) {
  return Object.fromEntries(
    RESULT_KEYS.filter((key) => key in result).map((key) => [key, normalizeValue(result[key])]),
  );
}

export function compareVideoRelevanceObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsVideoRelevance({ payload }) {
  const operation = String(payload?.operation || 'sort').trim().toLowerCase();
  const videos = Array.isArray(payload?.videos) ? payload.videos : [];
  const searchQueries = Array.isArray(payload?.searchQueries)
    ? payload.searchQueries
    : payload?.searchQueries || payload?.searchQuery
      ? [payload.searchQueries || payload.searchQuery]
      : [];
  const targetExistingTerms = Array.isArray(payload?.targetExistingTerms)
    ? payload.targetExistingTerms
    : payload?.targetExistingTerms || payload?.targetExistingTerm || payload?.targetTerms || payload?.targetTerm
      ? [payload.targetExistingTerms || payload.targetExistingTerm || payload.targetTerms || payload.targetTerm]
      : [];
  const needles = searchNeedlesForRelevance(searchQueries, targetExistingTerms);

  if (operation === 'filter') {
    return {
      ok: true,
      operation,
      needles,
      videos: filterRelevantVideos(videos, searchQueries, targetExistingTerms),
    };
  }
  if (operation === 'score') {
    return {
      ok: true,
      operation,
      needles,
      scores: videos.map((video) => ({ video, score: relevanceScoreForVideo(video, needles) })),
    };
  }
  return {
    ok: true,
    operation: 'sort',
    needles,
    videos: sortVideosByRelevance(videos, searchQueries, targetExistingTerms),
  };
}

async function runPythonVideoRelevance({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.video_relevance', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || DEFAULT_FIXTURE_NAMES[0];
  const resolved = VIDEO_RELEVANCE_FIXTURES[name] || VIDEO_RELEVANCE_FIXTURES[DEFAULT_FIXTURE_NAMES[0]];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareVideoRelevanceSingle({
  payload,
  fixture,
  runJs = runJsVideoRelevance,
  runPython = runPythonVideoRelevance,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'video-relevance-compare-'));
  try {
    const payloadPath = join(tempDir, 'video-relevance.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    const context = {
      payload: resolved.payload,
      payloadPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareVideoRelevanceObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareVideoRelevance({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsVideoRelevance,
  runPython = runPythonVideoRelevance,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareVideoRelevanceSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareVideoRelevanceSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareVideoRelevance({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
