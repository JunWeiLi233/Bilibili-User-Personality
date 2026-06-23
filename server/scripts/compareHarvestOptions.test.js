import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareHarvestOptions,
  compareHarvestOptionsObjects,
} from './compareHarvestOptions.js';

test('compareHarvestOptionsObjects reports option contract drift', () => {
  const result = compareHarvestOptionsObjects(
    {
      mode: 'video-keyword',
      options: { maxQueries: 3, includeHistoryTags: true },
      ignored: true,
    },
    {
      mode: 'video-keyword',
      options: { maxQueries: 4, includeHistoryTags: true },
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'options',
      python: { maxQueries: 3, includeHistoryTags: true },
      js: { maxQueries: 4, includeHistoryTags: true },
    },
  ]);
  assert.deepEqual(result.python, {
    mode: 'video-keyword',
    options: { maxQueries: 3, includeHistoryTags: true },
  });
});

test('compareHarvestOptions compares injected JS and Python option runners', async () => {
  const result = await compareHarvestOptions({
    payload: { mode: 'video-keyword', env: { BILIBILI_HARVEST_MAX_QUERIES: '2' } },
    runJs: async () => ({ mode: 'video-keyword', options: { maxQueries: 2 } }),
    runPython: async () => ({ mode: 'video-keyword', options: { maxQueries: 2 } }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});
