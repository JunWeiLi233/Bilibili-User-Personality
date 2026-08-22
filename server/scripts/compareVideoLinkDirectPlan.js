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

export const VIDEO_LINK_DIRECT_FIXTURES = {
  video: DEFAULT_PAYLOAD,
  favorite: {
    argv: ['--favorite-link', 'https://space.bilibili.com/233/favlist?fid=456', '--pages', '5'],
  },
  uid: {
    argv: ['--uid', '233', '--cookie', 'SESSDATA=1', '--pages', '4'],
  },
  'missing-target': {
    argv: ['--pages', '2'],
  },
};

const DEFAULT_FIXTURE_NAMES = ['video', 'favorite', 'uid', 'missing-target'];

function resolvePayload({ fixture = 'video', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'video');
  return { name, payload: VIDEO_LINK_DIRECT_FIXTURES[name] || DEFAULT_PAYLOAD };
}

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
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.video_link_direct_plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error?.stdout || '';
    if (!stdout) throw error;
  }
  return JSON.parse(stdout);
}

function runJsVideoLinkDirectPlan({ payload }) {
  return buildVideoLinkDirectPlan(payload);
}

export async function compareVideoLinkDirectPlan({
  fixture = 'video',
  payload,
  runJs = runJsVideoLinkDirectPlan,
  runPython = runPythonVideoLinkDirectPlan,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'video-link-direct-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareVideoLinkDirectPlanObjects(python, js);
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

export async function compareVideoLinkDirectPlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareVideoLinkDirectPlan({ fixture }));
  }
  return {
    ok: results.every((result) => result.ok),
    fixtures: results.map((result) => ({
      name: result.fixture.name,
      ok: result.ok,
      js: result.js,
      python: result.python,
      mismatches: result.mismatches,
    })),
  };
}

async function main() {
  const result = await compareVideoLinkDirectPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
