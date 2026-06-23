import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['termAttempts', 'backfilled'];

export const DEFAULT_PAYLOAD = {
  mode: 'default',
  strategyVersion: 7,
  finishedAt: '2026-06-19T00:00:00.000Z',
  planItem: {
    term: '测试',
    family: 'attack',
    query: '测试 评论区',
    variantIndex: 1,
    evidenceCount: 0,
  },
  result: {
    ok: false,
    error: 'fixture miss',
    videos: [],
    comments: [],
  },
};

function cleanText(value) {
  return String(value || '').trim();
}

function nonNegativeInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function termAttemptKey(term) {
  return Buffer.from(String(term || ''), 'utf8').toString('base64url').replace(/=+$/g, '');
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareHarvestStateObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function readJson(path, fallback) {
  try {
    const payload = JSON.parse(await readFile(path, 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}

function acceptedResultTerms(result = {}) {
  const diagnostics = result.collectionDiagnostics && typeof result.collectionDiagnostics === 'object' ? result.collectionDiagnostics : {};
  const terms = [];
  if (Array.isArray(diagnostics.acceptedTerms)) terms.push(...diagnostics.acceptedTerms);
  if (Array.isArray(result.entries)) terms.push(...result.entries.map((entry) => entry?.term));
  const keywordTraining = result.keywordTraining && typeof result.keywordTraining === 'object' ? result.keywordTraining : {};
  if (Array.isArray(keywordTraining.dictionaryEvidenceEntries)) {
    terms.push(...keywordTraining.dictionaryEvidenceEntries.map((entry) => entry?.term));
  }
  return new Set(terms.map(cleanText).filter(Boolean));
}

function updateTermAttempt(termAttempts = {}, planItem = {}, result = {}, finishedAt = '', options = {}) {
  const attempts = { ...termAttempts };
  const term = cleanText(planItem.term);
  if (!term) return attempts;
  const key = termAttemptKey(term);
  const current = attempts[key] && typeof attempts[key] === 'object' ? attempts[key] : {};
  const plannedEvidenceCount = Number(planItem.coverageEvidenceCount ?? planItem.evidenceCount ?? current.evidenceAtPlanTime ?? 0) || 0;
  const acceptedTerms = acceptedResultTerms(result);
  const hit = Boolean(result.ok) && acceptedTerms.has(term) && nonNegativeInt(result.lastEvidenceCount) > plannedEvidenceCount;
  const previousQueries = Array.isArray(current.queries) ? current.queries : [];
  const at = finishedAt || new Date().toISOString();
  const priorSuccessful = nonNegativeInt(current.successfulAttempts);
  const queryRecord = {
    at,
    query: planItem.query,
    strategyVersion: Math.max(0, Number(options.harvestStrategyVersion ?? planItem.strategyVersion ?? 0) || 0),
    ok: Boolean(result.ok),
    hit,
    videos: Array.isArray(result.videos) ? result.videos.length : 0,
    comments: Array.isArray(result.comments) ? result.comments.length : 0,
    error: result.error || '',
  };
  attempts[key] = {
    key,
    term,
    family: planItem.family || current.family || 'unknown',
    evidenceAtPlanTime: planItem.evidenceCount ?? current.evidenceAtPlanTime ?? 0,
    lastVariantIndex: planItem.variantIndex ?? current.lastVariantIndex ?? null,
    attempts: nonNegativeInt(current.attempts) + 1,
    successfulAttempts: priorSuccessful + (hit ? 1 : 0),
    lastAttemptAt: at,
    lastSuccessfulAt: hit ? at : current.lastSuccessfulAt || null,
    lastQuery: planItem.query,
    lastError: result.ok ? '' : result.error || '',
    lastEvidenceCount: hit ? nonNegativeInt(result.lastEvidenceCount) : nonNegativeInt(current.lastEvidenceCount),
    queries: [...previousQueries, queryRecord].slice(-20),
  };
  return attempts;
}

async function runJsHarvestState({ payloadPath }) {
  const payload = await readJson(payloadPath, {});
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  const termAttempts =
    payload.state && typeof payload.state === 'object' && payload.state.termAttempts && typeof payload.state.termAttempts === 'object'
      ? payload.state.termAttempts
      : payload.termAttempts && typeof payload.termAttempts === 'object'
      ? payload.termAttempts
      : {};
  const nextAttempts = updateTermAttempt(
    termAttempts,
    payload.planItem && typeof payload.planItem === 'object' ? payload.planItem : {},
    payload.result && typeof payload.result === 'object' ? payload.result : {},
    payload.finishedAt || payload.attemptFinishedAt || '',
    { ...options, harvestStrategyVersion: payload.strategyVersion || options.harvestStrategyVersion || 0 },
  );
  return { ok: true, termAttempts: nextAttempts };
}

async function runPythonHarvestState({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.harvest_state', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(payloadPath, payload) {
  await writeFile(payloadPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareHarvestState({ payload = DEFAULT_PAYLOAD, runJs = runJsHarvestState, runPython = runPythonHarvestState } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'harvest-state-compare-'));
  try {
    const payloadPath = payload.payloadPath || join(tempDir, 'harvest-state.json');
    if (!payload.payloadPath) await writeFixture(payloadPath, payload);
    const context = { payload, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareHarvestStateObjects(python, js);
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
  const result = await compareHarvestState();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
