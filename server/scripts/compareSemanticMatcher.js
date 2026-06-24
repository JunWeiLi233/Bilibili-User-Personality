import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chunkCommentText, cosineSimilarity } from '../services/semanticMatcher.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['ok', 'mode', 'chunks', 'cosine', 'matches', 'embeddingTexts', 'cache', 'count', 'entries'];

export const SEMANTIC_MATCHER_FIXTURES = {
  'match-precomputed-vectors': {
    payload: {
      chunks: ['alpha semantic chunk', 'beta semantic chunk'],
      vectors: { left: [1, 0], right: [0.8, 0.6] },
      chunkEmbeddings: [[1, 0], [0.8, 0.6]],
      termEmbeddings: { alpha: [1, 0], beta: [0, 1] },
      threshold: 0.5,
    },
    expected: {
      ok: true,
      mode: 'match',
      chunks: ['alpha semantic chunk', 'beta semantic chunk'],
      cosine: 0.8,
      matches: [
        { term: 'alpha', chunk: 'alpha semantic chunk', score: 1 },
        { term: 'alpha', chunk: 'beta semantic chunk', score: 0.8 },
        { term: 'beta', chunk: 'beta semantic chunk', score: 0.6 },
      ],
    },
  },
  'cache-payload': {
    payload: {
      mode: 'cache',
      now: '2026-06-24T00:00:00.000Z',
      dictionary: {
        version: 2,
        entries: [
          { term: 'doge', meaning: 'satire marker', variants: ['dog'] },
          { term: '', meaning: 'ignored' },
          { term: 'yygq', meaning: 'sarcasm' },
        ],
      },
      embeddings: { doge: [1, '2'], yygq: [0.25, 'bad'], extra: [9] },
    },
    expected: {
      ok: true,
      mode: 'cache',
      embeddingTexts: ['doge: satire marker | 鍙樹綋: dog', 'yygq: sarcasm'],
      cache: {
        dictionaryVersion: 2,
        termCount: 3,
        builtAt: '2026-06-24T00:00:00.000Z',
        embeddings: { doge: [1, 2], yygq: [0.25, 0] },
      },
    },
  },
  'evidence-weak-terms': {
    payload: {
      mode: 'evidence',
      now: '2026-06-24T00:00:00.000Z',
      dictionary: {
        entries: [
          { term: 'doge', family: 'attack', meaning: 'satire marker', evidenceCount: 0 },
          { term: 'covered', family: 'attack', meaning: 'covered', evidenceCount: 3 },
        ],
      },
      matches: [
        { term: 'doge', chunk: 'doge chunk one', score: 0.91234 },
        { term: 'doge', chunk: 'doge chunk one', score: 0.88 },
        { term: 'doge', chunk: 'doge chunk two', score: 0.8 },
        { term: 'covered', chunk: 'covered chunk', score: 0.99 },
      ],
      targetEvidence: 3,
      source: 'Bilibili public comment semantic match',
      uid: 'BV1',
    },
    expected: {
      ok: true,
      mode: 'evidence',
      count: 1,
      entries: [
        {
          term: 'doge',
          evidenceSamples: ['doge chunk one', 'doge chunk two'],
          evidenceSources: [
            { source: '[Semantic match, score=0.9123] Bilibili public comment semantic match', uid: 'BV1', sample: 'doge chunk one' },
            { source: '[Semantic match, score=0.88] Bilibili public comment semantic match', uid: 'BV1', sample: 'doge chunk one' },
            { source: '[Semantic match, score=0.8] Bilibili public comment semantic match', uid: 'BV1', sample: 'doge chunk two' },
          ],
          updatedAt: '2026-06-24T00:00:00.000Z',
          evidenceCount: 2,
        },
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(SEMANTIC_MATCHER_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareSemanticMatcherObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function numericVector(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : 0;
  });
}

function matchCommentToTerms(chunks = [], chunkEmbeddings = [], termEmbeddings = {}, threshold = 0.72) {
  const cleanChunks = chunks.map((chunk) => String(chunk || '').trim()).filter((chunk) => chunk.length >= 8);
  if (cleanChunks.length === 0 || !termEmbeddings || typeof termEmbeddings !== 'object') return [];

  const matches = [];
  for (let chunkIndex = 0; chunkIndex < cleanChunks.length; chunkIndex += 1) {
    if (chunkIndex >= chunkEmbeddings.length) break;
    const chunkVector = numericVector(chunkEmbeddings[chunkIndex]);
    for (const [term, termVector] of Object.entries(termEmbeddings)) {
      const score = cosineSimilarity(chunkVector, numericVector(termVector));
      if (score >= threshold) {
        matches.push({ term: String(term), chunk: cleanChunks[chunkIndex], score: Number(score.toFixed(4)) });
      }
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const match of matches.sort((left, right) => right.score - left.score)) {
    const key = `${match.term}\0${match.chunk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return deduped;
}

function embeddingTexts(dictionary = {}) {
  const entries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const term = String(entry.term || '').trim();
    if (!term) return [];
    const meaning = String(entry.meaning || '').trim();
    const variants = Array.isArray(entry.variants)
      ? entry.variants.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
      : '';
    return [variants ? `${term}: ${meaning} | 鍙樹綋: ${variants}` : `${term}: ${meaning}`];
  });
}

function buildCachePayload(dictionary = {}, embeddings = {}, now = '') {
  const entries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
  const terms = entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => String(entry.term || '').trim())
    .filter(Boolean);
  const normalizedEmbeddings = {};
  for (const term of terms) {
    if (Object.hasOwn(embeddings, term)) normalizedEmbeddings[term] = numericVector(embeddings[term]);
  }
  return {
    dictionaryVersion: dictionary.version,
    termCount: entries.length,
    builtAt: now,
    embeddings: normalizedEmbeddings,
  };
}

function buildEvidenceEntries({
  dictionary = {},
  matches = [],
  targetEvidence = 3,
  source = 'Bilibili public comment semantic match',
  uid = '',
  now = '',
} = {}) {
  const weakTerms = new Set(
    (Array.isArray(dictionary.entries) ? dictionary.entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .filter((entry) => Number(entry.evidenceCount || 0) < Number(targetEvidence || 3))
      .map((entry) => String(entry.term || '').trim())
      .filter(Boolean),
  );
  const byTerm = new Map();
  const seenSamples = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || typeof match !== 'object') continue;
    const term = String(match.term || '').trim();
    const chunk = String(match.chunk || '').trim();
    if (!weakTerms.has(term) || !chunk) continue;
    if (!byTerm.has(term)) {
      byTerm.set(term, { term, evidenceSamples: [], evidenceSources: [], updatedAt: now });
    }
    const entry = byTerm.get(term);
    if (!seenSamples.has(term)) seenSamples.set(term, new Set());
    const seen = seenSamples.get(term);
    if (!seen.has(chunk)) {
      seen.add(chunk);
      if (entry.evidenceSamples.length < 5) entry.evidenceSamples.push(chunk);
    }
    if (entry.evidenceSources.length < 8) {
      entry.evidenceSources.push({
        source: `[Semantic match, score=${Number(Number(match.score || 0).toFixed(4))}] ${source}`,
        uid,
        sample: chunk,
      });
    }
  }
  return [...byTerm.values()].map((entry) => ({ ...entry, evidenceCount: entry.evidenceSamples.length }));
}

async function runJsSemanticMatcher({ payload }) {
  const mode = String(payload.mode || 'match').trim().toLowerCase();
  if (mode === 'cache') {
    const dictionary = payload.dictionary && typeof payload.dictionary === 'object' ? payload.dictionary : {};
    const embeddings = payload.embeddings && typeof payload.embeddings === 'object' ? payload.embeddings : {};
    return {
      ok: true,
      mode: 'cache',
      embeddingTexts: embeddingTexts(dictionary),
      cache: buildCachePayload(dictionary, embeddings, String(payload.now || '')),
    };
  }
  if (mode === 'evidence') {
    const entries = buildEvidenceEntries({
      dictionary: payload.dictionary && typeof payload.dictionary === 'object' ? payload.dictionary : {},
      matches: Array.isArray(payload.matches) ? payload.matches : [],
      targetEvidence: Number(payload.targetEvidence || 3),
      source: String(payload.source || 'Bilibili public comment semantic match'),
      uid: String(payload.uid || ''),
      now: String(payload.now || ''),
    });
    return { ok: true, mode: 'evidence', count: entries.length, entries };
  }
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : chunkCommentText(payload.text || '');
  const vectors = payload.vectors && typeof payload.vectors === 'object' ? payload.vectors : {};
  return {
    ok: true,
    mode: 'match',
    chunks,
    cosine: Number(cosineSimilarity(numericVector(vectors.left), numericVector(vectors.right)).toFixed(4)),
    matches: matchCommentToTerms(
      chunks,
      Array.isArray(payload.chunkEmbeddings) ? payload.chunkEmbeddings : [],
      payload.termEmbeddings && typeof payload.termEmbeddings === 'object' ? payload.termEmbeddings : {},
      Number(payload.threshold || 0.72),
    ),
  };
}

async function runPythonSemanticMatcher({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.semantic_matcher', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function resolveFixture({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'match-precomputed-vectors';
  const resolved = SEMANTIC_MATCHER_FIXTURES[name] || SEMANTIC_MATCHER_FIXTURES['match-precomputed-vectors'];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareSemanticMatcherSingle({
  payload,
  fixture,
  runJs = runJsSemanticMatcher,
  runPython = runPythonSemanticMatcher,
} = {}) {
  const resolved = resolveFixture({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'semantic-matcher-compare-'));
  try {
    const payloadPath = join(tempDir, 'semantic-matcher.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const context = {
      payload: resolved.payload,
      payloadPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareSemanticMatcherObjects(python, js);
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

export async function compareSemanticMatcher({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsSemanticMatcher,
  runPython = runPythonSemanticMatcher,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareSemanticMatcherSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareSemanticMatcherSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareSemanticMatcher({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
