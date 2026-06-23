import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['count', 'comments'];

export const DEFAULT_PAYLOAD = {
  _uidComments: {
    42: [
      {
        message: '本地语料评论',
        uname: 'tester',
        bvid: 'BVflat',
      },
    ],
  },
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareLocalCorpusFlattenObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function readPayload(payloadPath) {
  try {
    return JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    return {};
  }
}

async function runJsLocalCorpusFlatten({ payloadPath }) {
  const payload = await readPayload(payloadPath);
  const comments = flattenBilibiliCommentCorpus(payload);
  return { ok: true, count: comments.length, comments };
}

async function runPythonLocalCorpusFlatten({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.local_corpus_flatten', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(payloadPath, payload) {
  await writeFile(payloadPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareLocalCorpusFlatten({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsLocalCorpusFlatten,
  runPython = runPythonLocalCorpusFlatten,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'local-flatten-compare-'));
  try {
    const payloadPath = payload.payloadPath || join(tempDir, 'local-flatten.json');
    if (!payload.payloadPath) await writeFixture(payloadPath, payload);
    const context = { payload, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareLocalCorpusFlattenObjects(python, js);
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
  const result = await compareLocalCorpusFlatten();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
