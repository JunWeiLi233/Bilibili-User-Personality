import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UID_PIPELINE_STATE_FIXTURES,
  compareUidPipelineState,
  compareUidPipelineStateObjects,
} from './compareUidPipelineState.js';

const SUMMARY = {
  startedAt: '2026-06-19T00:00:00.000Z',
  workers: [
    { start: 1, end: 2, progressFile: 'uid-pipeline-1-2.json', processed: 2, total: 2, complete: true },
    { start: 3, end: 4, progressFile: 'uid-pipeline-3-4.json', processed: 1, total: 2, complete: false },
  ],
  summary: { workers: 2, completedWorkers: 1, totalProcessed: 3, totalExpected: 4, completionRatio: 0.75 },
  stats: { success: 1, noComments: 1, noVideos: 0, noUser: 0, trainError: 0, blocked: 1, errors: 0 },
};

test('compareUidPipelineStateObjects reports matching state summaries', () => {
  const result = compareUidPipelineStateObjects({ ok: true, ...SUMMARY, extra: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareUidPipelineState compares JS-compatible and Python launcher state reports', async () => {
  const calls = [];
  const result = await compareUidPipelineState({
    payload: { startedAt: SUMMARY.startedAt },
    runJs: async (context) => {
      calls.push({ js: context.dataDir.endsWith('data') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.dataDir.endsWith('data') });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareUidPipelineState exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(UID_PIPELINE_STATE_FIXTURES), ['default-state', 'parseint-worker-prefix', 'corrupt-progress']);

  const contexts = [];
  const result = await compareUidPipelineState({
    fixtureNames: Object.keys(UID_PIPELINE_STATE_FIXTURES),
    runJs: async (context) => {
      contexts.push({ js: context.fixture.name });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      contexts.push({ python: context.fixture.name });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['default-state', 'parseint-worker-prefix', 'corrupt-progress']);
  assert.deepEqual(contexts, [
    { js: 'default-state' },
    { python: 'default-state' },
    { js: 'parseint-worker-prefix' },
    { python: 'parseint-worker-prefix' },
    { js: 'corrupt-progress' },
    { python: 'corrupt-progress' },
  ]);
});
