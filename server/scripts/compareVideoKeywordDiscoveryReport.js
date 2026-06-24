import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  priorityActionItemsFromHarvestResult,
  serializeVideoKeywordDiscoveryReport,
} from '../utils/runVideoKeywordDiscoveryReport.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'report', 'priorityActionItems', 'trainingDiagnostics', 'queryDiagnostics', 'roundSummary'];

export const DEFAULT_PAYLOAD = {
  generatedAt: '2026-06-23T00:00:00.000Z',
  statePath: 'server/data/coverageHarvestState.json',
  reportPath: 'server/data/videoKeywordDiscoveryReport.json',
  result: {
    requestedRounds: 1,
    growth: { before: 1, after: 2 },
    coverage: null,
    coverageActions: [{ term: 'doge', action: 'retry', nextQuery: 'doge hot' }],
    state: null,
    rounds: [
      {
        queries: ['doge hot'],
        candidateQueries: null,
        growth: null,
        coverage: null,
        coverageProgress: null,
        termAttemptSummary: null,
        trainingDiagnostics: null,
        queryDiagnostics: null,
        warnings: null,
        results: [],
      },
    ],
  },
};

export const RICH_DISCOVERY_PAYLOAD = {
  generatedAt: '2026-06-23T00:00:00.000Z',
  statePath: 'server/data/coverageHarvestState.json',
  reportPath: 'server/data/videoKeywordDiscoveryReport.json',
  result: {
    requestedRounds: 1,
    growth: { before: 4, after: 6 },
    coverage: { evidenceDeficit: 3, coverageRatio: 0.25 },
    coverageActions: [{ term: 'fallback', action: 'none', nextQuery: 'fallback old' }],
    priorityCoverageActions: [
      {
        term: 'doge',
        family: 'evidence',
        action: 'retry_with_new_variant',
        status: 'weak_missed',
        nextQuery: 'doge hot 评论区',
        suggestedQueries: ['doge hot 弹幕'],
      },
    ],
    state: { searchedQueries: ['doge hot 评论区'] },
    rounds: [
      {
        queries: ['doge hot 评论区'],
        candidateQueries: ['doge hot 评论区', 'doge hot 弹幕'],
        growth: { before: 4, after: 6 },
        coverage: { evidenceDeficit: 3 },
        coverageProgress: { evidenceGained: 2, evidenceDeficitReduced: 1 },
        acceptedEvidenceCount: 2,
        coverageIncreasingAcceptedEvidenceCount: 2,
        termAttemptSummary: { attemptedTerms: 1, exhaustedTerms: 0 },
        trainingDiagnostics: {
          deepseekCalls: 1,
          fallbackCalls: 0,
          evidenceRejected: 1,
          dictionaryEvidenceTerms: 1,
          dictionaryEvidenceCount: 2,
          generatedTerms: 1,
        },
        queryDiagnostics: [
          {
            query: 'doge hot 评论区',
            ok: true,
            commentsCollected: 2,
            trainingTextChars: 128,
            targetExistingTerms: ['doge'],
            acceptedTerms: ['doge'],
            evidenceRejected: 1,
          },
        ],
        warnings: ['fixture warning'],
        plan: [{ query: 'doge hot 评论区', source: 'priorityCoverageActions', term: 'doge' }],
        results: [
          {
            query: 'doge hot 评论区',
            result: {
              ok: true,
              videos: [
                {
                  bvid: 'BV1RichAAA11',
                  title: 'doge rich fixture',
                  sourceUrl: 'https://www.bilibili.com/video/BV1RichAAA11/',
                },
              ],
              comments: [{ text: 'doge 第一条' }, { text: 'doge 第二条' }],
              keywordTraining: {
                evidenceRejected: 1,
                dictionaryEvidenceEntries: [
                  {
                    term: 'doge',
                    evidenceCount: 2,
                    evidenceSamples: ['doge 第一条', 'doge 第二条'],
                    evidenceSources: [
                      { source: 'Bilibili public video comment scan', sample: 'doge 第一条' },
                      { source: 'Bilibili public video comment scan', sample: 'doge 第二条' },
                    ],
                  },
                ],
              },
              collectionDiagnostics: {
                discoveredVideos: 1,
                scannedVideos: 1,
                commentsCollected: 2,
                trainingTextChars: 128,
              },
              controversialPopularQueries: ['doge 热评'],
              controversialPopularSearchOrder: ['doge hot 评论区', 'doge 热评'],
              entries: [{ term: 'doge', family: 'evidence', evidenceCount: 2 }],
            },
          },
        ],
      },
    ],
  },
};

export const DANMAKU_DISCOVERY_PAYLOAD = {
  generatedAt: '2026-06-23T00:00:00.000Z',
  statePath: 'server/data/coverageHarvestState.json',
  reportPath: 'server/data/videoKeywordDiscoveryReport.json',
  result: {
    requestedRounds: 1,
    growth: { before: 2, after: 3 },
    coverage: { evidenceDeficit: 1, coverageRatio: 0.5 },
    coverageActions: [{ term: '狗头', action: 'retry', nextQuery: '狗头 弹幕' }],
    state: { searchedQueries: ['狗头 弹幕'] },
    rounds: [
      {
        queries: ['狗头 弹幕'],
        candidateQueries: ['狗头 弹幕'],
        growth: { before: 2, after: 3 },
        coverage: { evidenceDeficit: 1 },
        coverageProgress: { evidenceGained: 1, evidenceDeficitReduced: 1 },
        acceptedEvidenceCount: 1,
        coverageIncreasingAcceptedEvidenceCount: 1,
        termAttemptSummary: { attemptedTerms: 1, successfulTerms: 1 },
        trainingDiagnostics: {
          deepseekCalls: 1,
          fallbackCalls: 0,
          evidenceRejected: 0,
          dictionaryEvidenceTerms: 1,
          dictionaryEvidenceCount: 1,
          generatedTerms: 0,
        },
        queryDiagnostics: [
          {
            query: '狗头 弹幕',
            ok: true,
            commentsCollected: 1,
            trainingTextChars: 32,
            targetExistingTerms: ['狗头'],
            acceptedTerms: ['狗头'],
            evidenceRejected: 0,
          },
        ],
        warnings: [],
        plan: [{ query: '狗头 弹幕', source: 'priorityCoverageActions', term: '狗头', includeDanmaku: true }],
        results: [
          {
            query: '狗头 弹幕',
            result: {
              ok: true,
              videos: [
                {
                  bvid: 'BV1Danmaku11',
                  title: '狗头弹幕 fixture',
                  sourceUrl: 'https://www.bilibili.com/video/BV1Danmaku11/',
                },
              ],
              comments: [{ text: '狗头保命', source: 'danmaku' }],
              keywordTraining: {
                evidenceRejected: 0,
                dictionaryEvidenceEntries: [
                  {
                    term: '狗头',
                    evidenceCount: 1,
                    evidenceSamples: ['狗头保命'],
                    evidenceSources: [
                      { source: 'Bilibili public video danmaku scan', sample: '狗头保命' },
                    ],
                  },
                ],
              },
              collectionDiagnostics: {
                discoveredVideos: 1,
                scannedVideos: 1,
                commentsCollected: 1,
                trainingTextChars: 32,
              },
              entries: [{ term: '狗头', family: 'meme', evidenceCount: 1 }],
            },
          },
        ],
      },
    ],
  },
};

const FIXTURES = {
  default: DEFAULT_PAYLOAD,
  'rich-discovery': RICH_DISCOVERY_PAYLOAD,
  'danmaku-discovery': DANMAKU_DISCOVERY_PAYLOAD,
};

const DEFAULT_FIXTURE_NAMES = ['default', 'rich-discovery', 'danmaku-discovery'];

function resolvePayload({ fixture = 'default', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'default');
  return { name, payload: FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareVideoKeywordDiscoveryReportObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsReport({ payload }) {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
  const report = serializeVideoKeywordDiscoveryReport(result, payload?.statePath || '', payload?.reportPath || '');
  if (payload?.generatedAt) report.generatedAt = payload.generatedAt;
  return {
    ok: true,
    mode: 'report',
    report,
    priorityActionItems: priorityActionItemsFromHarvestResult(result),
  };
}

async function runPythonReport({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.discovery_report', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareVideoKeywordDiscoveryReport({
  fixture = 'default',
  payload,
  runJs = runJsReport,
  runPython = runPythonReport,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'discovery-report-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareVideoKeywordDiscoveryReportObjects(python, js);
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

export async function compareVideoKeywordDiscoveryReportSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareVideoKeywordDiscoveryReport({ fixture }));
  }
  return {
    ok: results.every((result) => result.ok),
    fixtures: results.map((result) => ({
      name: result.fixture.name,
      ok: result.ok,
      js: result.js,
      python: result.python,
      mismatches: result.mismatches,
    })),
  };
}

async function main() {
  const result = await compareVideoKeywordDiscoveryReportSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
