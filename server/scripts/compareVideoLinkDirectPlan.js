import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildVideoLinkDirectPlan } from './runVideoLinkDirect.js';

const execFileAsync = promisify(execFile);
const SUMMARY_KEYS = ['mode', 'input', 'collect', 'training'];

export const DEFAULT_PAYLOAD = {
  argv: ['--video-link', 'https://www.bilibili.com/video/BV1xx411c7mD', '--cookie', 'SESSDATA=1', '--pages', '3'],
};

function summarize(result = {}) {
  return Object.fromEntries(SUMMARY_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareVideoLinkDirectPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = SUMMARY_KEYS
    .filter((key) => JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runPythonVideoLinkDirectPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.video_link_direct_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function runJsVideoLinkDirectPlan({ payload }) {
  return buildVideoLinkDirectPlan(payload);
}

export async function compareVideoLinkDirectPlan({
  payload = DEFAULT_PAYLOAD,
  runJs = runJsVideoLinkDirectPlan,
  runPython = runPythonVideoLinkDirectPlan,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'video-link-direct-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareVideoLinkDirectPlanObjects(python, js);
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
  const result = await compareVideoLinkDirectPlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
