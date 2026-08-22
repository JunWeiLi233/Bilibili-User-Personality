import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildCollectionDiagnostics,
  buildTargetVideoObjectEvidenceText,
  buildVideoContextText,
  videoContextSourceUrls,
} from '../services/videoKeywordSearch.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['videoContextText', 'videoObjectEvidenceText', 'contextSourceUrls', 'diagnostics'];

export const VIDEO_CONTEXT_FIXTURES = {
  'context-and-evidence': {
    payload: {
      videos: [
        {
          bvid: 'BV1',
          title: '中国宝宝体质 名场面',
          desc: '评论区   复盘',
          description: '评论区 复盘',
          sourceUrl: 'https://www.bilibili.com/video/BV1',
        },
        { bvid: 'BV2', title: '路过视频', description: '无关' },
      ],
      discoveredVideos: [{ bvid: 'BVD', title: '发现素材', sourceUrl: 'https://www.bilibili.com/video/BVD' }],
      comments: [{ message: '中国宝宝体质' }],
      trainingText: '中国宝宝体质 中国宝宝体质 路过',
      searchQueries: ['中国宝宝体质 评论区'],
      targetExistingTerms: ['中国宝宝体质', '路过'],
      keywordTraining: {
        entries: [{ term: '中国宝宝体质' }],
        dictionaryEvidenceEntries: [{ term: '路过' }],
        evidenceRejected: '2',
      },
    },
  },
  'diagnostics-only': {
    payload: {
      videos: [],
      discoveredVideos: [{ bvid: 'BVD', title: '发现' }],
      discoveryContextVideos: [{ bvid: 'BVC', title: '上下文' }],
      comments: [{ message: '弹幕阴阳怪气' }, { message: '普通' }],
      trainingText: '弹幕阴阳怪气 弹幕阴阳怪气',
      targetExistingTerms: ['弹幕阴阳怪气'],
      keywordTraining: { entries: [{ term: '弹幕阴阳怪气' }], evidenceRejected: -3 },
    },
  },
  'discovery-context-dedupe': {
    payload: {
      videos: [{ bvid: 'BV1', title: '重复标题', sourceUrl: 'https://www.bilibili.com/video/BV1' }],
      discoveryContextVideos: [
        { bvid: 'BV1', title: '重复标题', sourceUrl: 'https://www.bilibili.com/video/BV1' },
        { bvid: 'BV2', title: '新上下文', desc: '补充描述', sourceUrl: 'https://www.bilibili.com/video/BV2' },
      ],
      searchQueries: ['新上下文'],
      targetExistingTerms: ['新上下文'],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(VIDEO_CONTEXT_FIXTURES);

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function videoContextSources(videos = [], discoveredVideos = []) {
  const seen = new Set();
  const result = [];
  for (const video of [...videos, ...discoveredVideos]) {
    if (!video || typeof video !== 'object') continue;
    const key = `${video.bvid || ''}\n${video.sourceUrl || ''}\n${video.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(video);
  }
  return result;
}

function summarize(result = {}) {
  const summary = Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
  return summary;
}

export function compareVideoContextObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsVideoContext({ payload }) {
  const videos = listValue(payload?.videos);
  const discoveredVideos = listValue(payload?.discoveredVideos);
  const discoveryContextVideos = listValue(payload?.discoveryContextVideos);
  const comments = listValue(payload?.comments);
  const searchQueries = listValue(payload?.searchQueries ?? payload?.searchQuery);
  const targetExistingTerms = listValue(
    payload?.targetExistingTerms ?? payload?.targetExistingTerm ?? payload?.targetTerms ?? payload?.targetTerm,
  );
  const contextVideos = videoContextSources(videos, discoveryContextVideos.length ? discoveryContextVideos : discoveredVideos);
  const trainingText = payload?.trainingText || '';
  return {
    ok: true,
    videoContextText: buildVideoContextText(contextVideos),
    videoObjectEvidenceText: buildTargetVideoObjectEvidenceText(contextVideos, searchQueries, targetExistingTerms),
    contextSourceUrls: videoContextSourceUrls(contextVideos),
    diagnostics: buildCollectionDiagnostics({
      discoveredVideos,
      discoveryContextVideos,
      videos,
      comments,
      trainingText,
      targetExistingTerms,
      keywordTraining: payload?.keywordTraining && typeof payload.keywordTraining === 'object' ? payload.keywordTraining : null,
    }),
  };
}

async function runPythonVideoContext({ payloadPath, jsReportPath }) {
  const baseArgs = ['-m', 'python_backend.cli.video_context', '--payload', payloadPath];
  const rawResult = await execFileAsync('python', baseArgs, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  const compareResult = await execFileAsync('python', [...baseArgs, '--compare-js-report', jsReportPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { raw: JSON.parse(rawResult.stdout), comparison: JSON.parse(compareResult.stdout) };
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || DEFAULT_FIXTURE_NAMES[0];
  const resolved = VIDEO_CONTEXT_FIXTURES[name] || VIDEO_CONTEXT_FIXTURES[DEFAULT_FIXTURE_NAMES[0]];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareVideoContextSingle({
  payload,
  fixture,
  runJs = runJsVideoContext,
  runPython = runPythonVideoContext,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'video-context-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    const context = {
      payload: resolved.payload,
      payloadPath,
      jsReportPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = (await runJs(context)) || {};
    await writeFile(jsReportPath, JSON.stringify(js, null, 2), 'utf8');
    const python = (await runPython(context)) || {};
    const pythonRaw = python.raw || python;
    const pythonComparison = python.comparison || {};
    const comparison = compareVideoContextObjects(pythonRaw, js);
    return {
      ok: (pythonComparison.ok ?? true) && comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python: pythonRaw,
      comparison: pythonComparison,
      mismatches: pythonComparison.mismatches?.length ? pythonComparison.mismatches : comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareVideoContext({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsVideoContext,
  runPython = runPythonVideoContext,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareVideoContextSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareVideoContextSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareVideoContext({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
