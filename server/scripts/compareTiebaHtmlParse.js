import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseTiebaThreadComments, parseTiebaThreads, tiebaThreadsToDiscoveryComments } from '../services/tiebaScraper.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'threads', 'comments'];

export const DEFAULT_PAYLOAD = {
  mode: 'threads',
  keyword: 'sample',
  html: '<a href="/p/1234567890" title="sample thread">sample thread</a>',
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareTiebaHtmlParseObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function parseJsPayload(payload = {}) {
  const mode = String(payload.mode || 'threads').trim().toLowerCase();
  const html = payload.html || '';
  const keyword = String(payload.keyword || '');
  if (mode === 'comments') {
    return {
      ok: true,
      mode: 'comments',
      comments: parseTiebaThreadComments(html, payload.thread && typeof payload.thread === 'object' ? payload.thread : {}),
    };
  }
  if (mode === 'discovery-comments') {
    const threads = Array.isArray(payload.threads) ? payload.threads : parseTiebaThreads(html, keyword);
    return {
      ok: true,
      mode: 'discovery-comments',
      threads,
      comments: tiebaThreadsToDiscoveryComments(threads, keyword),
    };
  }
  return {
    ok: true,
    mode: 'threads',
    threads: parseTiebaThreads(html, keyword),
  };
}

async function runJsParser({ payload }) {
  return parseJsPayload(payload);
}

async function runPythonParser({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_html_parse', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareTiebaHtmlParse({ payload = DEFAULT_PAYLOAD, runJs = runJsParser, runPython = runPythonParser } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-html-parse-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareTiebaHtmlParseObjects(python, js);
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
  const result = await compareTiebaHtmlParse();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
