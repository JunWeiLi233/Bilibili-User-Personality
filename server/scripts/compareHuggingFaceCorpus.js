import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildHuggingFaceCorpusUpdate, parseHuggingFaceRows } from '../services/huggingFaceCorpus.js';

const execFileAsync = promisify(execFile);

const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const EXISTING_BILIBILI_MESSAGE = '\u65e7B\u7ad9\u8bc4\u8bba';
const NEW_BILIBILI_MESSAGE = '\u65b0B\u7ad9\u5f39\u5e55[doge]';
const EXISTING_TIEBA_MESSAGE = '\u65e7\u8d34\u5427\u8bc4\u8bba';
const KAGGLE_MESSAGE = '\u6765\u81eaKaggle\u7684B\u7ad9\u8bc4\u8bba';
const SUMMARY_KEYS = ['importedRows', 'changed', 'addedComments', 'corpusCommentMessages', 'corpusRunAts'];

export const HUGGINGFACE_CORPUS_FIXTURES = {
  'bilibili-csv-import': {
    raw: 'comment,uid,uname,sourceUrl\n\u65b0B\u7ad9\u5f39\u5e55[doge],420,\u963f\u5b85,u\n',
    payload: {
      dataset: 'Midsummra/bilibilicomment',
      file: 'bilibili.csv',
      platform: 'bilibili',
      limit: 10,
      offset: 0,
      generatedAt: GENERATED_AT,
      existing: {
        version: 1,
        updatedAt: '2026-06-22T00:00:00.000Z',
        runs: [{ at: 'old-run' }],
        comments: [{ message: EXISTING_BILIBILI_MESSAGE, platform: 'bilibili', sourceUrl: 'old' }],
      },
    },
    expected: {
      importedRows: 1,
      changed: true,
      addedComments: 1,
      corpusCommentMessages: [EXISTING_BILIBILI_MESSAGE, NEW_BILIBILI_MESSAGE],
      corpusRunAts: ['old-run', GENERATED_AT],
    },
  },
  'tieba-jsonl-title-detail': {
    raw: '{"title":"\u65e7\u8d34\u5427","detail":"\u65e7\u8d34\u5427\u8bc4\u8bba","href":"https://tieba.baidu.com/p/1"}\n',
    payload: {
      dataset: 'Orphanage/Baidu_Tieba_SunXiaochuan',
      file: 'train.jsonl',
      platform: 'tieba',
      limit: 5,
      offset: 0,
      generatedAt: GENERATED_AT,
      existing: {
        version: 1,
        updatedAt: '2026-06-22T00:00:00.000Z',
        runs: [{ at: 'old-run' }],
        comments: [{ message: EXISTING_TIEBA_MESSAGE, platform: 'tieba', sourceUrl: 'https://tieba.baidu.com/p/1' }],
      },
    },
    expected: {
      importedRows: 1,
      changed: true,
      addedComments: 1,
      corpusCommentMessages: [EXISTING_TIEBA_MESSAGE, '\u65e7\u8d34\u5427 \u65e7\u8d34\u5427\u8bc4\u8bba'],
      corpusRunAts: ['old-run', GENERATED_AT],
    },
  },
  'kaggle-json-import-dedupe': {
    raw: JSON.stringify([
      { comment: KAGGLE_MESSAGE, platform: 'bilibili', sourceUrl: 'kaggle-row-1' },
      { comment: KAGGLE_MESSAGE, platform: 'bilibili', sourceUrl: 'kaggle-row-1' },
      { comment: 'ascii only', platform: 'bilibili', sourceUrl: 'kaggle-row-2' },
    ]),
    payload: {
      dataset: 'kaggle:hongbinmiao/kun-bilibili-b',
      file: 'comments.json',
      platform: 'bilibili',
      limit: 10,
      offset: 0,
      generatedAt: GENERATED_AT,
      existing: { version: 1, updatedAt: null, runs: [], comments: [] },
    },
    expected: {
      importedRows: 2,
      changed: true,
      addedComments: 1,
      corpusCommentMessages: [KAGGLE_MESSAGE],
      corpusRunAts: [GENERATED_AT],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(HUGGINGFACE_CORPUS_FIXTURES);

function summarize(result = {}) {
  if (
    SUMMARY_KEYS.every((key) => key in result)
    && Array.isArray(result.corpusCommentMessages)
    && Array.isArray(result.corpusRunAts)
  ) {
    return Object.fromEntries(SUMMARY_KEYS.map((key) => [key, result[key]]));
  }
  const corpus = result.corpus && typeof result.corpus === 'object' ? result.corpus : {};
  const comments = Array.isArray(corpus.comments) ? corpus.comments : [];
  const runs = Array.isArray(corpus.runs) ? corpus.runs : [];
  return {
    importedRows: Number(result.importedRows) || 0,
    changed: result.changed === true,
    addedComments: Number(result.addedComments) || 0,
    corpusCommentMessages: comments.map((comment) => comment?.message).filter(Boolean),
    corpusRunAts: runs.map((run) => run?.at).filter(Boolean),
  };
}

export function compareHuggingFaceCorpusObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsImport({ raw, payload }) {
  const source = {
    dataset: payload.dataset,
    file: payload.file,
    platform: payload.platform,
    limit: payload.limit,
    offset: payload.offset,
  };
  const rows = parseHuggingFaceRows(raw, source);
  const run = {
    at: payload.generatedAt,
    sources: [source],
    results: [{ ...source, ok: true, rows: rows.length }],
  };
  return {
    ok: true,
    importedRows: rows.length,
    ...buildHuggingFaceCorpusUpdate(payload.existing, rows, run, payload.generatedAt),
  };
}

async function runPythonImport({ rawPath, existingPath, payload }) {
  const { stdout } = await execFileAsync(
    'python',
    [
      '-m',
      'python_backend.cli.huggingface_corpus',
      '--raw',
      rawPath,
      '--existing',
      existingPath,
      '--dataset',
      payload.dataset,
      '--file',
      payload.file,
      '--platform',
      payload.platform,
      '--limit',
      String(payload.limit),
      '--offset',
      String(payload.offset),
      '--generated-at',
      payload.generatedAt,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareHuggingFaceCorpus({
  raw,
  payload,
  fixture,
  fixtureNames,
  runJs = runJsImport,
  runPython = runPythonImport,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareHuggingFaceCorpus({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? HUGGINGFACE_CORPUS_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'bilibili-csv-import';
  const resolvedRaw = raw ?? resolvedFixture?.raw ?? HUGGINGFACE_CORPUS_FIXTURES['bilibili-csv-import'].raw;
  const resolvedPayload = payload || resolvedFixture?.payload || HUGGINGFACE_CORPUS_FIXTURES['bilibili-csv-import'].payload;
  const tempDir = await mkdtemp(join(tmpdir(), 'huggingface-corpus-compare-'));
  try {
    const rawPath = join(tempDir, 'raw.txt');
    const existingPath = join(tempDir, 'existing.json');
    await writeFile(rawPath, resolvedRaw, 'utf8');
    await writeFile(existingPath, JSON.stringify(resolvedPayload.existing || {}, null, 2), 'utf8');
    const context = {
      raw: resolvedRaw,
      rawPath,
      existingPath,
      payload: resolvedPayload,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareHuggingFaceCorpusObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, rawPath, existingPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareHuggingFaceCorpus({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
