import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { computeTiebaScrapeHardStopMs } from '../services/tiebaScrapeTiming.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['hardStopMs'];

export const DEFAULT_PAYLOAD = {
  maxQueries: 4,
  overallTimeoutMs: 30000,
  blockCooldownMs: 120000,
};

export const TIEBA_TIMING_FIXTURES = {
  'default-budget': {
    payload: DEFAULT_PAYLOAD,
    expected: { hardStopMs: 610000 },
  },
  'zero-query-fallback': {
    payload: {
      maxQueries: 0,
      overallTimeoutMs: 30000,
      blockCooldownMs: 120000,
    },
    expected: { hardStopMs: 160000 },
  },
  'string-and-negative-coercion': {
    payload: {
      maxQueries: '2',
      overallTimeoutMs: '-1',
      blockCooldownMs: 'bad',
    },
    expected: { hardStopMs: 10000 },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(TIEBA_TIMING_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareTiebaTimingObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsTiming({ payload }) {
  return { hardStopMs: computeTiebaScrapeHardStopMs(payload) };
}

async function runPythonTiming({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_timing', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareTiebaTiming({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsTiming,
  runPython = runPythonTiming,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareTiebaTiming({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? TIEBA_TIMING_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-timing-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolvedPayload, null, 2), 'utf8');
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareTiebaTimingObjects(python, js);
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
  const result = await compareTiebaTiming({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
