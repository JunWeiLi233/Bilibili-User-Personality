import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { findLocalCorpusEvidenceEntries, flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';

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

const DEFAULT_EVIDENCE_ENTRY = {
  term: '查查资料',
  family: 'evidence',
  meaning: '索要证据',
  evidence: ['你先查查资料再说'],
  evidenceSamples: ['你先查查资料再说'],
  evidenceSources: [
    {
      source: 'Bilibili local corpus',
      uid: 'BVlocal',
      sample: '你先查查资料再说',
    },
  ],
};

export const LOCAL_CORPUS_EVIDENCE_FIXTURES = {
  'target-term-match': {
    payload: DEFAULT_PAYLOAD,
    expected: { ok: true, count: 1, entries: [DEFAULT_EVIDENCE_ENTRY] },
  },
  'weak-term-ranking': {
    payload: {
      dictionary: {
        entries: [
          {
            term: 'alpha',
            family: 'attack',
            meaning: 'rank alpha evidence',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
      comments: [
        { message: 'alpha evidence sample with enough surrounding text', source: 'Bilibili local corpus', uid: 'BVlong' },
        { message: 'alpha short', source: 'Bilibili local corpus', uid: 'BVshort' },
      ],
      targetEvidence: 3,
      maxSamplesPerTerm: 2,
    },
    expected: {
      ok: true,
      count: 1,
      entries: [
        {
          term: 'alpha',
          family: 'attack',
          meaning: 'rank alpha evidence',
          evidence: ['alpha short', 'alpha evidence sample with enough surrounding text'],
          evidenceSamples: ['alpha short', 'alpha evidence sample with enough surrounding text'],
          evidenceSources: [
            { source: 'Bilibili local corpus', uid: 'BVshort', sample: 'alpha short' },
            { source: 'Bilibili local corpus', uid: 'BVlong', sample: 'alpha evidence sample with enough surrounding text' },
          ],
        },
      ],
    },
  },
  'source-backfill': {
    payload: {
      dictionary: {
        entries: [
          {
            term: 'backfill',
            family: 'evidence',
            meaning: 'recover unsourced local evidence',
            evidenceCount: 1,
            evidenceSamples: ['backfill term existing sample'],
            evidenceSources: [],
          },
        ],
      },
      comments: [
        {
          message: 'backfill term existing sample',
          source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVbackfill/',
          uid: 'BVbackfill',
        },
      ],
      targetEvidence: 2,
      maxSamplesPerTerm: 1,
      requireCommentBackedEvidence: true,
    },
    expected: {
      ok: true,
      count: 1,
      entries: [
        {
          term: 'backfill',
          family: 'evidence',
          meaning: 'recover unsourced local evidence',
          evidence: ['backfill term existing sample'],
          evidenceSamples: ['backfill term existing sample'],
          evidenceSources: [
            {
              source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVbackfill/',
              uid: 'BVbackfill',
              sample: 'backfill term existing sample',
            },
          ],
        },
      ],
    },
  },
  'flattened-corpus-payload': {
    payload: {
      dictionary: {
        entries: [
          {
            term: 'flattened',
            family: 'evidence',
            meaning: 'flatten local corpus before evidence search',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      },
      corpus: {
        _uidComments: {
          42: [{ message: 'flattened evidence from uid map', uname: 'fixture-user', bvid: 'BVflatEvidence' }],
        },
      },
      targetEvidence: 3,
      maxSamplesPerTerm: 1,
    },
    expected: {
      ok: true,
      count: 1,
      entries: [
        {
          term: 'flattened',
          family: 'evidence',
          meaning: 'flatten local corpus before evidence search',
          evidence: ['flattened evidence from uid map'],
          evidenceSamples: ['flattened evidence from uid map'],
          evidenceSources: [
            {
              source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVflatEvidence/',
              uid: 'BVflatEvidence',
              sample: 'flattened evidence from uid map',
            },
          ],
        },
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(LOCAL_CORPUS_EVIDENCE_FIXTURES);

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
  const comments = Array.isArray(payload.comments) ? payload.comments : flattenBilibiliCommentCorpus(payload.corpus || payload);
  const entries = findLocalCorpusEvidenceEntries(
    payload.dictionary && typeof payload.dictionary === 'object' ? payload.dictionary : { entries: [] },
    comments,
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
  payload,
  fixture,
  fixtureNames,
  runJs = runJsLocalCorpusEvidence,
  runPython = runPythonLocalCorpusEvidence,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareLocalCorpusEvidence({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? LOCAL_CORPUS_EVIDENCE_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'local-evidence-compare-'));
  try {
    const payloadPath = resolvedPayload.payloadPath || join(tempDir, 'local-evidence.json');
    if (!resolvedPayload.payloadPath) await writeFixture(payloadPath, resolvedPayload);
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareLocalCorpusEvidenceObjects(python, js);
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
  const result = await compareLocalCorpusEvidence({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
