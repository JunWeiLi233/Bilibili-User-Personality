import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildTiebaCorpusUpdate } from '../services/tiebaCorpus.js';

const execFileAsync = promisify(execFile);

const GENERATED_AT = '2026-06-23T00:00:00.000Z';
const EXISTING_MESSAGE = '\u65e7\u8d34\u5427\u8bc4\u8bba';
const NEW_MESSAGE = '\u65b0\u8d34\u5427\u8bc4\u8bba';
const SUMMARY_KEYS = ['changed', 'newCommentMessages', 'corpusCommentMessages', 'corpusRunAts'];

export const DEFAULT_PAYLOAD = {
  existing: {
    version: 1,
    updatedAt: '2026-06-22T00:00:00.000Z',
    runs: [{ at: 'old-run' }],
    comments: [{ message: EXISTING_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/1', rpid: 'tieba-1' }],
  },
  run: {
    at: GENERATED_AT,
    queries: ['\u8d34\u5427\u8bed\u6599'],
    results: [
      {
        query: '\u8d34\u5427\u8bed\u6599',
        comments: [
          { message: EXISTING_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/1', rpid: 'tieba-1' },
          { message: NEW_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/2', rpid: 'tieba-2' },
        ],
        warnings: [],
      },
    ],
    warnings: [],
  },
  generatedAt: GENERATED_AT,
};

const LONG_RUN_HISTORY = Array.from({ length: 55 }, (_, index) => ({ at: `old-${index}` }));

export const TIEBA_CORPUS_UPDATE_FIXTURES = {
  'merge-new-comments': {
    payload: DEFAULT_PAYLOAD,
    expected: {
      changed: true,
      newCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
      corpusCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
      corpusRunAts: ['old-run', GENERATED_AT],
    },
  },
  'unchanged-empty-run': {
    payload: {
      existing: {
        version: 1,
        updatedAt: '2026-06-22T00:00:00.000Z',
        runs: [{ at: 'old-run' }],
        comments: [{ message: EXISTING_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/1', rpid: 'tieba-1' }],
      },
      run: {
        at: GENERATED_AT,
        queries: ['blocked query'],
        results: [{ query: 'blocked query', comments: [], warnings: ['Tieba safety verification page returned'] }],
        warnings: ['blocked'],
      },
      generatedAt: GENERATED_AT,
    },
    expected: {
      changed: false,
      newCommentMessages: [],
      corpusCommentMessages: [EXISTING_MESSAGE],
      corpusRunAts: ['old-run'],
    },
  },
  'dedupe-and-cap-runs': {
    payload: {
      existing: {
        version: 1,
        updatedAt: '2026-06-22T00:00:00.000Z',
        runs: LONG_RUN_HISTORY,
        comments: [{ message: EXISTING_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/1', rpid: 'tieba-1' }],
      },
      run: {
        at: GENERATED_AT,
        results: [
          {
            comments: [
              { message: EXISTING_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/1', rpid: 'tieba-1' },
              { message: NEW_MESSAGE, sourceUrl: 'https://tieba.baidu.com/p/2', rpid: 'tieba-2' },
              { message: '', sourceUrl: 'https://tieba.baidu.com/p/empty', rpid: 'tieba-empty' },
            ],
          },
        ],
      },
      generatedAt: GENERATED_AT,
    },
    expected: {
      changed: true,
      newCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
      corpusCommentMessages: [EXISTING_MESSAGE, NEW_MESSAGE],
      corpusRunAts: [...LONG_RUN_HISTORY.slice(-49).map((run) => run.at), GENERATED_AT],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(TIEBA_CORPUS_UPDATE_FIXTURES);

function summarize(result = {}) {
  if (
    typeof result.changed === 'boolean'
    && Array.isArray(result.newCommentMessages)
    && Array.isArray(result.corpusCommentMessages)
    && Array.isArray(result.corpusRunAts)
  ) {
    return {
      changed: result.changed,
      newCommentMessages: result.newCommentMessages,
      corpusCommentMessages: result.corpusCommentMessages,
      corpusRunAts: result.corpusRunAts,
    };
  }
  const newComments = Array.isArray(result.newComments) ? result.newComments : [];
  const corpus = result.corpus && typeof result.corpus === 'object' ? result.corpus : {};
  const corpusComments = Array.isArray(corpus.comments) ? corpus.comments : [];
  const corpusRuns = Array.isArray(corpus.runs) ? corpus.runs : [];
  return {
    changed: result.changed === true,
    newCommentMessages: newComments.map((comment) => comment?.message).filter(Boolean),
    corpusCommentMessages: corpusComments.map((comment) => comment?.message).filter(Boolean),
    corpusRunAts: corpusRuns.map((run) => run?.at).filter(Boolean),
  };
}

export function compareTiebaCorpusUpdateObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS.filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsUpdate({ payload }) {
  return { ok: true, ...buildTiebaCorpusUpdate(payload.existing, payload.run, payload.generatedAt) };
}

async function runPythonUpdate({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_corpus', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareTiebaCorpusUpdate({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsUpdate,
  runPython = runPythonUpdate,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareTiebaCorpusUpdate({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? TIEBA_CORPUS_UPDATE_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-corpus-update-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolvedPayload, null, 2), 'utf8');
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareTiebaCorpusUpdateObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareTiebaCorpusUpdate({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
