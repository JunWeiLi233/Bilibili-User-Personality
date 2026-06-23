import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareDirectProbeCommand, compareDirectProbeCommandObjects } from './compareDirectProbeCommand.js';

const TERM = '\u67e5\u67e5\u8d44\u6599';
const QUERY = `${TERM} B\u7ad9\u8bc4\u8bba`;
const MESSAGE = '\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599\u518d\u8bc4\u8bba';

const COMMAND_SUMMARY = {
  actions: [{ term: TERM, query: QUERY }],
  commentsCollected: 1,
  commentMessages: [MESSAGE],
  scannedVideoKeys: ['aid:777'],
  entryTerms: [TERM],
  warnings: [],
};

test('compareDirectProbeCommandObjects compares JS and Python command summaries', () => {
  const result = compareDirectProbeCommandObjects(
    { ok: true, ignored: true, ...COMMAND_SUMMARY },
    { ok: true, ignored: false, ...COMMAND_SUMMARY },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, COMMAND_SUMMARY);
  assert.deepEqual(result.js, COMMAND_SUMMARY);
});

test('compareDirectProbeCommand runs injected JS and Python command runners', async () => {
  const calls = [];
  const result = await compareDirectProbeCommand({
    runJs: async ({ payload }) => {
      calls.push({ runner: 'js', query: payload.audit.nextActions[0].nextQuery });
      return { ok: true, ...COMMAND_SUMMARY };
    },
    runPython: async ({ payload }) => {
      calls.push({ runner: 'python', videos: payload.searchVideos[QUERY].length });
      return { ok: true, ...COMMAND_SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { runner: 'js', query: QUERY },
    { runner: 'python', videos: 1 },
  ]);
});
