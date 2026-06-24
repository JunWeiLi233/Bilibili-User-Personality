import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { filterCommentsByDictionaryNeedles } from '../services/videoKeywordSearch.js';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['applied', 'matched', 'before', 'after', 'needleCount', 'comments'];

export const VIDEO_COMMENT_FILTER_FIXTURES = {
  'needle-filter': {
    payload: {
      comments: [
        { rpid: '1', message: '哈哈哈 网 盘 见！' },
        { rpid: '2', message: '完全无关' },
        { rpid: '3', message: '这就是中国宝宝体质了' },
      ],
      needles: ['网盘见'],
      extraNeedles: ['中国宝宝体质'],
    },
    expected: {
      ok: true,
      applied: true,
      matched: 2,
      before: 3,
      after: 2,
      needleCount: 2,
      comments: [{ rpid: '1' }, { rpid: '3' }],
    },
  },
  'dictionary-prefilter': {
    payload: {
      dictionaryMode: true,
      existingTermsOnly: true,
      comments: [
        { rpid: '1', message: '建议网 盘 见' },
        { rpid: '2', message: '纯路过' },
        { rpid: '3', message: '这是中国宝宝体质了' },
      ],
      dictionary: {
        entries: [
          { term: '网盘见', aliases: ['网盘链接'], examples: ['去网盘见'] },
          { term: 'x', aliases: ['中国宝宝体质'] },
        ],
      },
    },
    expected: {
      ok: true,
      applied: true,
      before: 3,
      after: 2,
      needleCount: 4,
      comments: [{ rpid: '1' }, { rpid: '3' }],
    },
  },
  'fallback-empty-match': {
    payload: {
      comments: [
        { rpid: '1', message: '路过看看' },
        { rpid: '2', message: '普通评论' },
      ],
      needles: ['不存在的词'],
      extraNeedles: [],
    },
    expected: {
      ok: true,
      applied: false,
      matched: 0,
      before: 2,
      after: 2,
      needleCount: 1,
      comments: [{ rpid: '1' }, { rpid: '2' }],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(VIDEO_COMMENT_FILTER_FIXTURES);

function cleanSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '')
    .toLowerCase();
}

function uniqueByKey(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function dictionaryEntryNeedles(entry = {}) {
  return uniqueByKey(
    [
      entry.term,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ...(Array.isArray(entry.examples) ? entry.examples : []),
    ]
      .filter((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))
      .map(cleanSearchText)
      .filter((item) => item.length >= 2),
    (item) => item,
  );
}

function dictionaryNeedleSet(dictionary = {}) {
  const set = new Set();
  for (const entry of Array.isArray(dictionary.entries) ? dictionary.entries : []) {
    for (const needle of dictionaryEntryNeedles(entry)) set.add(needle);
  }
  return set;
}

function commentId(comment) {
  if (!comment || typeof comment !== 'object') return comment;
  return comment.rpid || comment.id || comment.uid || comment.message || comment;
}

function normalizeValue(value) {
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object')) {
    return value.map(commentId);
  }
  return value;
}

function summarize(result = {}) {
  return Object.fromEntries(
    RESULT_KEYS.filter((key) => key in result).map((key) => [key, normalizeValue(result[key])]),
  );
}

export function compareVideoCommentFilterObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsVideoCommentFilter({ payload }) {
  const comments = Array.isArray(payload?.comments) ? payload.comments : [];
  const extraNeedles = Array.isArray(payload?.extraNeedles)
    ? payload.extraNeedles
    : payload?.extraNeedle
      ? [payload.extraNeedle]
      : [];

  if (payload?.dictionaryMode) {
    if (!payload?.existingTermsOnly || comments.length === 0) {
      return { ok: true, comments, applied: false, needleCount: 0, before: comments.length, after: comments.length };
    }
    const filtered = filterCommentsByDictionaryNeedles(comments, dictionaryNeedleSet(payload.dictionary), extraNeedles);
    return {
      ok: true,
      comments: filtered.comments,
      applied: filtered.applied,
      needleCount: filtered.needleCount,
      before: comments.length,
      after: filtered.comments.length,
    };
  }

  const needles = Array.isArray(payload?.needles) ? payload.needles : [];
  const filtered = filterCommentsByDictionaryNeedles(comments, new Set(needles.map(cleanSearchText)), extraNeedles);
  return {
    ok: true,
    before: comments.length,
    after: filtered.comments.length,
    comments: filtered.comments,
    needleCount: filtered.needleCount,
    matched: filtered.matched,
    applied: filtered.applied,
  };
}

async function runPythonVideoCommentFilter({ commentsPath, needlesPath, jsReportPath, payload }) {
  const baseArgs = ['-m', 'python_backend.cli.video_comment_filter', '--comments', commentsPath, '--needles', needlesPath];
  const args = [...baseArgs];
  for (const extra of Array.isArray(payload?.extraNeedles) ? payload.extraNeedles : []) {
    args.push('--extra-needle', extra);
  }
  if (payload?.dictionaryMode) args.push('--dictionary-mode');
  if (payload?.existingTermsOnly) args.push('--existing-terms-only');
  const rawResult = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  const compareResult = await execFileAsync('python', [...args, '--compare-js-report', jsReportPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { raw: JSON.parse(rawResult.stdout), comparison: JSON.parse(compareResult.stdout) };
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || DEFAULT_FIXTURE_NAMES[0];
  const resolved = VIDEO_COMMENT_FILTER_FIXTURES[name] || VIDEO_COMMENT_FILTER_FIXTURES[DEFAULT_FIXTURE_NAMES[0]];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareVideoCommentFilterSingle({
  payload,
  fixture,
  runJs = runJsVideoCommentFilter,
  runPython = runPythonVideoCommentFilter,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'video-comment-filter-compare-'));
  try {
    const commentsPath = join(tempDir, 'comments.json');
    const needlesPath = join(tempDir, resolved.payload?.dictionaryMode ? 'dictionary.json' : 'needles.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(commentsPath, JSON.stringify({ comments: resolved.payload?.comments || [] }, null, 2), 'utf8');
    await writeFile(
      needlesPath,
      JSON.stringify(resolved.payload?.dictionaryMode ? resolved.payload?.dictionary || {} : { needles: resolved.payload?.needles || [] }, null, 2),
      'utf8',
    );
    const context = {
      payload: resolved.payload,
      commentsPath,
      needlesPath,
      jsReportPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = (await runJs(context)) || {};
    await writeFile(jsReportPath, JSON.stringify(js, null, 2), 'utf8');
    const python = (await runPython(context)) || {};
    const pythonRaw = python.raw || python;
    const pythonComparison = python.comparison || {};
    const comparison = compareVideoCommentFilterObjects(pythonRaw, js);
    return {
      ok: (pythonComparison.ok ?? true) && comparison.ok,
      fixture: { name: resolved.name, commentsPath, needlesPath },
      js,
      python: pythonRaw,
      comparison: pythonComparison,
      mismatches: pythonComparison.mismatches?.length ? pythonComparison.mismatches : comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareVideoCommentFilter({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsVideoCommentFilter,
  runPython = runPythonVideoCommentFilter,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareVideoCommentFilterSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareVideoCommentFilterSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareVideoCommentFilter({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
