import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { extractBvid, parseBvidPool, parseDanmakuXml } from '../services/bilibiliCrawler.js';

const execFileAsync = promisify(execFile);
const SUMMARY_KEYS = ['mode', 'bvids', 'bvid', 'comments'];

export const DEFAULT_PAYLOAD = {
  mode: 'danmaku',
  xml: '<i><d p="1,1,25,16777215,1710000000,0,12345,0">compare &amp; parse</d></i>',
  video: {
    bvid: 'BVcompare',
    oid: '123',
    replyType: 1,
    title: 'compare video',
    sourceUrl: 'https://www.bilibili.com/video/BVcompare/',
    cid: '456',
  },
};

function summarize(result = {}) {
  return Object.fromEntries(SUMMARY_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBilibiliParseObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS
    .filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function runJsBilibiliParse({ payload }) {
  const mode = String(payload?.mode || 'danmaku').trim().toLowerCase();
  if (mode === 'bvid-pool') {
    return { ok: true, mode, bvids: parseBvidPool(payload.raw) };
  }
  if (mode === 'extract-bvid') {
    return { ok: true, mode, bvid: extractBvid(payload.input) };
  }
  return {
    ok: true,
    mode: 'danmaku',
    comments: parseDanmakuXml(payload?.xml || '', payload?.video || {}),
  };
}

async function runPythonBilibiliParse({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.bilibili_parse', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareBilibiliParse({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsBilibiliParse,
  runPython = runPythonBilibiliParse,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'bilibili-parse-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareBilibiliParseObjects(python, js);
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
  const result = await compareBilibiliParse();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
