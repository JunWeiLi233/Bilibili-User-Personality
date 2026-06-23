import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { evidenceNeedlesForTerm } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['ok', 'mode', 'count', 'entries'];

export const DEFAULT_PAYLOAD = {
  entries: [
    { term: 'YYGQ', family: 'attack', meaning: 'Chinese initialism' },
    { term: 'missing', family: 'attack', meaning: 'not present' },
  ],
  text: 'YYGQ once\nyygq twice',
  source: 'Bilibili public comment target expansion',
  uid: 'mid-1',
};

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanKeywordTerm(value) {
  return cleanText(value).toLowerCase();
}

function cleanEvidenceText(value) {
  return cleanText(value).toLowerCase();
}

function unique(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = String(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareKeywordEvidenceObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function countNonOverlappingNeedles(haystack, needles = []) {
  let remaining = String(haystack || '');
  let count = 0;
  for (const needle of [...needles].filter(Boolean).sort((left, right) => right.length - left.length)) {
    let index = 0;
    while (index <= remaining.length) {
      const found = remaining.indexOf(needle, index);
      if (found === -1) break;
      count += 1;
      remaining = `${remaining.slice(0, found)}${' '.repeat(needle.length)}${remaining.slice(found + needle.length)}`;
      index = found + needle.length;
    }
  }
  return count;
}

function evidenceForTerm(term, text, { source = '', uid = '' } = {}) {
  const needles = evidenceNeedlesForTerm(term);
  let evidenceCount = 0;
  const samples = [];
  const sources = [];
  const sourceText = String(source || '').trim();
  const uidText = String(uid || '').trim();
  for (const line of String(text || '').split(/\r?\n/)) {
    const cleanLine = cleanEvidenceText(line);
    if (!needles.some((needle) => cleanLine.includes(needle))) continue;
    const sample = cleanText(line);
    if (!sample) continue;
    evidenceCount += countNonOverlappingNeedles(cleanLine, needles);
    if (samples.length < 3) {
      const clipped = sample.length > 120 ? `${sample.slice(0, 120)}...` : sample;
      samples.push(clipped);
      if (sourceText || uidText) sources.push({ source: sourceText, uid: uidText, sample: clipped });
    }
  }
  return {
    evidenceCount,
    evidenceSamples: unique(samples).slice(0, 3),
    evidenceSources: uniqueSources(sources).slice(0, 3),
  };
}

function uniqueSources(sources = []) {
  const seen = new Set();
  const normalized = [];
  for (const source of sources) {
    const item = {
      source: cleanText(source.source),
      uid: cleanText(source.uid),
      sample: cleanText(source.sample),
    };
    const key = `${item.source}\0${item.uid}\0${item.sample}`;
    if (!item.sample || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

function normalizeEntry(entry = {}) {
  return {
    ...entry,
    term: cleanKeywordTerm(entry.term || entry.keyword || entry.text),
    family: cleanText(entry.family || 'attack'),
    meaning: cleanText(entry.meaning),
  };
}

async function readPayload(payloadPath) {
  try {
    const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

async function runJsKeywordEvidence({ payloadPath }) {
  const payload = await readPayload(payloadPath);
  const text = payload.text || '';
  const source = payload.source || '';
  const uid = payload.uid || '';
  const entries = [];
  for (const rawEntry of Array.isArray(payload.entries) ? payload.entries : []) {
    const entry = normalizeEntry(rawEntry);
    if (!entry.term) continue;
    const evidence = evidenceForTerm(entry.term, text, { source, uid });
    if (evidence.evidenceCount <= 0) continue;
    entries.push({ ...entry, ...evidence });
  }
  return { ok: true, mode: 'entries', count: entries.length, entries };
}

async function runPythonKeywordEvidence({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.keyword_evidence', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(payloadPath, payload) {
  await writeFile(payloadPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareKeywordEvidence({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsKeywordEvidence,
  runPython = runPythonKeywordEvidence,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'keyword-evidence-compare-'));
  try {
    const payloadPath = payload.payloadPath || join(tempDir, 'keyword-evidence.json');
    if (!payload.payloadPath) await writeFixture(payloadPath, payload);
    const context = { payload, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareKeywordEvidenceObjects(python, js);
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
  const result = await compareKeywordEvidence();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
