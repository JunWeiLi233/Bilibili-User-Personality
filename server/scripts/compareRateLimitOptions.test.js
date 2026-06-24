import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATE_LIMIT_OPTIONS_FIXTURES,
  compareRateLimitOptions,
  compareRateLimitOptionsObjects,
} from './compareRateLimitOptions.js';

test('compareRateLimitOptionsObjects reports option drift', () => {
  const result = compareRateLimitOptionsObjects(
    { mode: 'rate-limit-options', target: 'tieba', options: { minDelayMs: 0, jitterMs: 60000, blockCooldownMs: 120000 } },
    { mode: 'rate-limit-options', target: 'tieba', options: { minDelayMs: 5000, jitterMs: 3000, blockCooldownMs: 120000 } },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'options',
      python: { minDelayMs: 0, jitterMs: 60000, blockCooldownMs: 120000 },
      js: { minDelayMs: 5000, jitterMs: 3000, blockCooldownMs: 120000 },
    },
  ]);
});

test('compareRateLimitOptions compares injected JS and Python option runners', async () => {
  const result = await compareRateLimitOptions({
    payload: { target: 'direct-probe', delayMs: 0, jitterMs: 999999 },
    runJs: async () => ({ mode: 'rate-limit-options', target: 'direct-probe', options: { delayMs: 1000, jitterMs: 60000 } }),
    runPython: async () => ({ mode: 'rate-limit-options', target: 'direct-probe', options: { delayMs: 1000, jitterMs: 60000 } }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});

test('compareRateLimitOptions exports named fixtures', async () => {
  assert.deepEqual(Object.keys(RATE_LIMIT_OPTIONS_FIXTURES), [
    'tieba-bounds',
    'history-tags-delay',
    'direct-probe-floor',
    'bilibili-crawler-cooldown',
  ]);

  const calls = [];
  const result = await compareRateLimitOptions({
    fixtureNames: Object.keys(RATE_LIMIT_OPTIONS_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'rate-limit-options', target: context.payload.target, options: { ok: true } };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasPayloadPath: context.payloadPath.endsWith('payload.json') });
      return { mode: 'rate-limit-options', target: context.payload.target, options: { ok: true } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'tieba-bounds', hasPayloadPath: true },
    { python: 'tieba-bounds', hasPayloadPath: true },
    { js: 'history-tags-delay', hasPayloadPath: true },
    { python: 'history-tags-delay', hasPayloadPath: true },
    { js: 'direct-probe-floor', hasPayloadPath: true },
    { python: 'direct-probe-floor', hasPayloadPath: true },
    { js: 'bilibili-crawler-cooldown', hasPayloadPath: true },
    { python: 'bilibili-crawler-cooldown', hasPayloadPath: true },
  ]);
});
