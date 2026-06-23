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
  payload = DEFAULT_PAYLOAD,
  runJs = runJsUpdate,
  runPython = runPythonUpdate,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-corpus-update-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareTiebaCorpusUpdateObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareTiebaCorpusUpdate();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
