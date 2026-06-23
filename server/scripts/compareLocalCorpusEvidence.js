import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { findLocalCorpusEvidenceEntries } from '../services/localCorpusEvidence.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['count', 'terms', 'evidence'];

export const DEFAULT_PAYLOAD = {
  dictionary: {
    entries: [
      {
        term: '查查资料',
        family: 'evidence',
        meaning: '索要证据',
        evidenceCount: 0,
        evidenceSamples: [],
        evidenceSources: [],
      },
      {
        term: '吃相难看',
        family: 'attack',
        meaning: '批评姿态',
        evidenceCount: 3,
        evidenceSamples: ['旧证据'],
      },
    ],
  },
  comments: [
    { message: '你先查查资料再说', source: 'Bilibili local corpus', uid: 'BVlocal' },
    { message: '普通路过评论', source: 'Bilibili local corpus', uid: 'BVnoise' },
  ],
  targetEvidence: 3,
  maxSamplesPerTerm: 1,
  targetTerms: ['查查资料'],
};

function summarize(result = {}) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const summary = {
    count: result.count ?? entries.length,
    terms: entries.filter((entry) => entry && typeof entry === 'object').map((entry) => entry.term),
    evidence: Object.fromEntries(
      entries
        .filter((entry) => entry && typeof entry === 'object' && entry.term !== undefined)
        .map((entry) => [
          entry.term,
          Array.isArray(entry.evidence) ? entry.evidence : Array.isArray(entry.evidenceSamples) ? entry.evidenceSamples : [],
        ]),
    ),
  };
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in summary).map((key) => [key, summary[key]]));
}

export function compareLocalCorpusEvidenceObjects(pythonResult = {}, jsResult = {}) {
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
    const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

async function runJsLocalCorpusEvidence({ payloadPath }) {
  const payload = await readPayload(payloadPath);
  const entries = findLocalCorpusEvidenceEntries(
    payload.dictionary && typeof payload.dictionary === 'object' ? payload.dictionary : { entries: [] },
    Array.isArray(payload.comments) ? payload.comments : [],
    {
      targetEvidence: payload.targetEvidence,
      maxSamplesPerTerm: payload.maxSamplesPerTerm,
      requireCommentBackedEvidence: payload.requireCommentBackedEvidence === true,
      targetTerms: Array.isArray(payload.targetTerms) ? payload.targetTerms : [],
    },
  );
  return { ok: true, count: entries.length, entries };
}

async function runPythonLocalCorpusEvidence({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.local_corpus_evidence', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(payloadPath, payload) {
  await writeFile(payloadPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareLocalCorpusEvidence({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsLocalCorpusEvidence,
  runPython = runPythonLocalCorpusEvidence,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'local-evidence-compare-'));
  try {
    const payloadPath = payload.payloadPath || join(tempDir, 'local-evidence.json');
    if (!payload.payloadPath) await writeFixture(payloadPath, payload);
    const context = { payload, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareLocalCorpusEvidenceObjects(python, js);
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
  const result = await compareLocalCorpusEvidence();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
