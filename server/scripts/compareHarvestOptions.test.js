import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HARVEST_OPTIONS_FIXTURES,
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

test('compareHarvestOptions exports named option fixtures', async () => {
  assert.deepEqual(Object.keys(HARVEST_OPTIONS_FIXTURES), [
    'default-video-keyword',
    'priority-query-content',
    'expanded-template-options',
  ]);

  const calls = [];
  const result = await compareHarvestOptions({
    fixtureNames: Object.keys(HARVEST_OPTIONS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'video-keyword', options: { maxQueries: 2 } };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'video-keyword', options: { maxQueries: 2 } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'default-video-keyword', hasPayloadPath: true },
    { python: 'default-video-keyword', hasPayloadPath: true },
    { js: 'priority-query-content', hasPayloadPath: true },
    { python: 'priority-query-content', hasPayloadPath: true },
    { js: 'expanded-template-options', hasPayloadPath: true },
    { python: 'expanded-template-options', hasPayloadPath: true },
  ]);
});
