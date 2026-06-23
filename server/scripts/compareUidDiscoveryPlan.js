import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildUidDiscoveryPlan } from './uidDiscoveryScrape.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['resume', 'sources', 'scanning', 'analysis', 'stats', 'training'];

export const DEFAULT_PAYLOAD = {
  progress: {
    phase: 'analysis',
    scannedBvids: ['BV1', 'BV2'],
    processedUids: { 100: 'success' },
    stats: { videosScanned: 2, uidsFound: 3, uidsAnalyzed: 1, commentsCollected: 4, errors: 0 },
    videoQueueSize: 10,
  },
  comments: {
    100: [{ message: 'done', bvid: 'BV1' }],
    101: [{ message: '', bvid: 'BV2' }],
    102: [{ message: 'next', bvid: 'BV2' }],
  },
  database: {
    users: {
      100: { uid: '100' },
      999: { uid: '999' },
    },
  },
};

export const UID_DISCOVERY_PLAN_FIXTURES = {
  'analysis-resume': DEFAULT_PAYLOAD,
  'discovery-start': {
    progress: {
      phase: 'discovery',
      scannedBvids: [],
      processedUids: {},
      stats: {},
      videoQueueSize: 0,
    },
    comments: {},
    database: {
      users: {},
    },
  },
  'malformed-numeric-stats': {
    progress: {
      phase: 'analysis',
      scannedBvids: ['BV malformed'],
      processedUids: {},
      stats: {
        videosScanned: '12abc',
        uidsFound: '3.9x',
        uidsAnalyzed: 'not-a-number',
        commentsCollected: '4 comments',
        errors: '2x',
      },
      videoQueueSize: '8 queued',
    },
    comments: {
      100: [{ message: 'todo', bvid: 'BV malformed' }],
    },
    database: {
      users: {},
    },
  },
};

const DEFAULT_FIXTURE_NAMES = ['analysis-resume', 'discovery-start', 'malformed-numeric-stats'];

function resolvePayload({ fixture = 'analysis-resume', payload } = {}) {
  if (payload) return { name: fixture || 'custom', payload };
  const name = String(fixture || 'analysis-resume');
  return { name, payload: UID_DISCOVERY_PLAN_FIXTURES[name] || DEFAULT_PAYLOAD };
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareUidDiscoveryPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/uidDiscoveryScrape.js', '--plan-json', '--js-plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.uid_discovery_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareUidDiscoveryPlan({
  fixture = 'analysis-resume',
  payload,
  runJs = runJsPlan,
  runPython = runPythonPlan,
} = {}) {
  const resolved = resolvePayload({ fixture, payload });
  const tempDir = await mkdtemp(join(tmpdir(), 'uid-discovery-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload, null, 2), 'utf8');
    const js = await runJs({ payload: resolved.payload, payloadPath });
    const python = await runPython({ payload: resolved.payload, payloadPath });
    const comparison = compareUidDiscoveryPlanObjects(python, js);
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

export async function compareUidDiscoveryPlanSuite({ fixtures = DEFAULT_FIXTURE_NAMES } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareUidDiscoveryPlan({ fixture }));
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
  const result = await compareUidDiscoveryPlanSuite();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
