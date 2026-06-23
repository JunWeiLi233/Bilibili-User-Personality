import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildVideoKeywordDiscoveryOptions,
  parsePriorityQueryContent,
} from '../utils/runVideoKeywordDiscoveryOptions.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'options', 'priorityQueries'];

export const DEFAULT_PAYLOAD = {
  mode: 'video-keyword',
  cwd: process.cwd(),
  env: {
    BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
    BILIBILI_HARVEST_MAX_QUERIES: '2',
  },
  argv: ['--include-history-tags', '--history-tag-limit=7'],
  priorityQueries: [{ term: 'doge', nextQuery: 'doge hot' }],
  seedQueries: ['seed query'],
};

export const HARVEST_OPTIONS_FIXTURES = {
  'default-video-keyword': DEFAULT_PAYLOAD,
  'priority-query-content': {
    mode: 'priority-query-content',
    content: JSON.stringify(
      [
        { term: 'doge', nextQuery: 'doge hot' },
        { term: 'tieba', query: 'tieba roast' },
      ],
      null,
      2,
    ),
  },
  'expanded-template-options': {
    mode: 'video-keyword',
    env: {
      BILIBILI_HARVEST_MAX_QUERIES: '3',
      BILIBILI_HARVEST_EXISTING_TERMS_ONLY: '1',
    },
    argv: ['--include-danmaku', '--pages', '3', '--rounds=2'],
    priorityQueries: [{ term: 'emoji', nextQuery: 'emoji satire' }],
    seedQueries: ['emoji seed'],
    controversyQueries: ['controversy seed'],
    extraQueryTemplates: ['{term} 梗'],
    exhaustedSuggestionTemplates: ['{term} 重试'],
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(HARVEST_OPTIONS_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareHarvestOptionsObjects(pythonResult = {}, jsResult = {}) {
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
  const mode = String(payload?.mode || 'video-keyword').trim().toLowerCase();
  if (mode === 'priority-query-content') {
    return {
      ok: true,
      mode,
      priorityQueries: parsePriorityQueryContent(payload?.content),
    };
  }
  if (mode !== 'video-keyword') {
    return { ok: true, mode, options: {} };
  }
  return {
    ok: true,
    mode: 'video-keyword',
    options: buildVideoKeywordDiscoveryOptions({
      env: payload?.env && typeof payload.env === 'object' ? payload.env : {},
      argv: Array.isArray(payload?.argv) ? payload.argv : [],
      priorityQueries: Array.isArray(payload?.priorityQueries) ? payload.priorityQueries : [],
      seedQueries: Array.isArray(payload?.seedQueries) ? payload.seedQueries : [],
      controversyQueries: Array.isArray(payload?.controversyQueries) ? payload.controversyQueries : [],
      extraQueryTemplates: Array.isArray(payload?.extraQueryTemplates) ? payload.extraQueryTemplates : [],
      exhaustedSuggestionTemplates: Array.isArray(payload?.exhaustedSuggestionTemplates) ? payload.exhaustedSuggestionTemplates : [],
    }),
  };
}

async function runPythonOptions({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.harvest_options', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || 'default-video-keyword';
  return { name, payload: HARVEST_OPTIONS_FIXTURES[name] || DEFAULT_PAYLOAD };
}

async function compareHarvestOptionsSingle({ payload, fixture, runJs = runJsOptions, runPython = runPythonOptions } = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'harvest-options-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const normalizedPayload = { cwd: process.cwd(), ...resolved.payload };
    await writeFile(payloadPath, JSON.stringify(normalizedPayload, null, 2), 'utf8');
    const context = { payload: normalizedPayload, fixture: { name: resolved.name }, payloadPath };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareHarvestOptionsObjects(python, js);
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

export async function compareHarvestOptions({ payload, fixture, fixtureNames, runJs = runJsOptions, runPython = runPythonOptions } = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareHarvestOptionsSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareHarvestOptionsSingle({ payload: payload || DEFAULT_PAYLOAD, fixture, runJs, runPython });
}

async function main() {
  const result = await compareHarvestOptions({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
