import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RESULT_KEYS = ['mode', 'target', 'options'];

export const RATE_LIMIT_OPTIONS_FIXTURES = {
  'tieba-bounds': {
    target: 'tieba',
    minDelayMs: -5,
    jitterMs: 999999,
    blockCooldownMs: 'bad',
  },
  'history-tags-delay': {
    target: 'history-tags',
    rateLimit: { delayMs: -5, jitterMs: 999999, blockCooldownMs: 120000 },
  },
  'direct-probe-floor': {
    target: 'direct-probe',
    delayMs: 0,
    jitterMs: 999999,
  },
  'bilibili-crawler-cooldown': {
    target: 'bilibili-crawler',
    minDelayMs: 750,
    jitterMs: 'bad',
    blockCooldownMs: 999999,
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(RATE_LIMIT_OPTIONS_FIXTURES);

function boundedMs(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(Math.max(minimum, Math.min(number, maximum)));
}

function normalizeTarget(target) {
  return String(target || '').trim().toLowerCase().replaceAll('_', '-');
}

function sourceValue(payload, primary, secondary, fallback) {
  const nested = payload?.rateLimit && typeof payload.rateLimit === 'object' ? payload.rateLimit : {};
  if (primary in payload) return payload[primary];
  if (primary in nested) return nested[primary];
  if (secondary && secondary in payload) return payload[secondary];
  if (secondary && secondary in nested) return nested[secondary];
  return fallback;
}

function buildJsRateLimitOptions(payload = {}) {
  const target = normalizeTarget(payload.target || payload.source);
  const minDelayMs = sourceValue(payload, 'minDelayMs', 'delayMs', 5000);
  const jitterMs = sourceValue(payload, 'jitterMs', '', 3000);
  const blockCooldownMs = sourceValue(payload, 'blockCooldownMs', 'cooldownMs', 120000);
  const specs = {
    tieba: [
      ['minDelayMs', minDelayMs, 5000, 0, 60000],
      ['jitterMs', jitterMs, 3000, 0, 60000],
      ['blockCooldownMs', blockCooldownMs, 120000, 0, 300000],
    ],
    'history-tags': [
      ['delayMs', minDelayMs, 5000, 0, 120000],
      ['jitterMs', jitterMs, 2500, 0, 120000],
    ],
    'direct-probe': [
      ['delayMs', minDelayMs, 3000, 1000, 60000],
      ['jitterMs', jitterMs, 1500, 0, 60000],
    ],
    'bilibili-crawler': [
      ['minDelayMs', minDelayMs, 2500, 0, 60000],
      ['jitterMs', jitterMs, 2000, 0, 60000],
      ['blockCooldownMs', blockCooldownMs, 120000, 0, 300000],
    ],
  };
  return Object.fromEntries((specs[target] || []).map(([key, value, fallback, minimum, maximum]) => [
    key,
    boundedMs(value, fallback, minimum, maximum),
  ]));
}

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareRateLimitOptionsObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsOptions({ payload }) {
  const target = normalizeTarget(payload?.target || payload?.source);
  return {
    ok: true,
    mode: 'rate-limit-options',
    target,
    options: buildJsRateLimitOptions(payload),
  };
}

async function runPythonOptions({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.rate_limit_options', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonOptionsComparison({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.rate_limit_options', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'tieba-bounds';
  return { name, payload: RATE_LIMIT_OPTIONS_FIXTURES[name] || RATE_LIMIT_OPTIONS_FIXTURES['tieba-bounds'] };
}

async function compareRateLimitOptionsSingle({
  payload,
  fixture,
  runJs = runJsOptions,
  runPython = runPythonOptions,
  runCompare = runPythonOptionsComparison,
} = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'rate-limit-options-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    const context = { payload: resolved.payload, fixture: { name: resolved.name }, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(jsReportPath, JSON.stringify(js || {}, null, 2), 'utf8');
    const comparison = await runCompare({ ...context, jsReportPath, js, python, jsReport: js, pythonReport: python });
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath, jsReportPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareRateLimitOptions({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsOptions,
  runPython = runPythonOptions,
  runCompare = runPythonOptionsComparison,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareRateLimitOptionsSingle({ fixture: name, runJs, runPython, runCompare }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareRateLimitOptionsSingle({ payload: payload || RATE_LIMIT_OPTIONS_FIXTURES['tieba-bounds'], fixture, runJs, runPython, runCompare });
}

async function main() {
  const result = await compareRateLimitOptions({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
