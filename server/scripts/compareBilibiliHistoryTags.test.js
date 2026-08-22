import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HISTORY_TAG_FIXTURES,
  compareBilibiliHistoryTags,
  compareBilibiliHistoryTagsObjects,
} from './compareBilibiliHistoryTags.js';

test('compareBilibiliHistoryTagsObjects compares history-tag summaries', () => {
  const summary = {
    tags: 1,
    videos: 1,
    runs: 1,
    corpusBvids: ['BVhistory001'],
    planRequestUrls: ['https://example.invalid/search'],
  };

  const result = compareBilibiliHistoryTagsObjects({ ok: true, ...summary }, { ok: true, ignored: true, ...summary });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, summary);
  assert.deepEqual(result.js, summary);
});

test('compareBilibiliHistoryTags compares injected JS and Python runners', async () => {
  const calls = [];
  const result = await compareBilibiliHistoryTags({
    runJs: async ({ fixture, current, update, payload }) => {
      calls.push({ runner: 'js', fixture: fixture.name, currentVideos: current.videos.length, seedArgs: payload.argv.length });
      return fixture.expected;
    },
    runPython: async ({ fixture, currentPath, updatePath, payloadPath }) => {
      calls.push({ runner: 'python', fixture: fixture.name, hasFiles: Boolean(currentPath && updatePath && payloadPath) });
      return fixture.expected;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { runner: 'js', fixture: 'merge-and-plan', currentVideos: 1, seedArgs: 4 },
    { runner: 'python', fixture: 'merge-and-plan', hasFiles: true },
  ]);
});

test('compareBilibiliHistoryTags exports named offline fixtures', async () => {
  assert.deepEqual(Object.keys(HISTORY_TAG_FIXTURES), [
    'merge-and-plan',
    'seed-file-plan',
  ]);

  const result = await compareBilibiliHistoryTags({
    fixtureNames: Object.keys(HISTORY_TAG_FIXTURES),
    runJs: async ({ fixture }) => fixture.expected,
    runPython: async ({ fixture }) => fixture.expected,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});
