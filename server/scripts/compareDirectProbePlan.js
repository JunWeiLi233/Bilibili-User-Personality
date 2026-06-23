import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = [
  'nextReplyCursor',
  'viewUrl',
  'replyUrl',
  'replyPageUrl',
  'replyThreadUrl',
  'searchUrls',
  'syntheticCookie',
];

export const DEFAULT_PAYLOAD = {
  action: { term: '查查资料', query: '查查资料 B站评论' },
  videos: [
    { bvid: 'BVnoise', title: '热门回复' },
    { bvid: 'BVexact', title: '查查资料合集' },
  ],
  source: 'https://www.bilibili.com/video/av116663559131570/?reply=301234384593',
  cursorPayload: { data: { cursor: { is_end: false, next: 0 } } },
  referer: 'https://search.bilibili.com/all?keyword=x',
  cookie: 'a=b',
  delayMs: 0,
  jitterMs: 999999,
  syntheticCookie: { randomValue: 0.5, nowMs: 1700000000000 },
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareDirectProbePlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/probeBilibiliCommentEvidence.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.direct_probe_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareDirectProbePlan({ payload = DEFAULT_PAYLOAD, runJs = runJsPlan, runPython = runPythonPlan } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareDirectProbePlanObjects(python, js);
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
  const result = await compareDirectProbePlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
