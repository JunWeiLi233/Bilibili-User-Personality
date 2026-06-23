import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoLinkDirectPlan, runVideoLinkDirectCommand } from './runVideoLinkDirect.js';

test('runVideoLinkDirect builds JS/Python comparable direct video plans', () => {
  const result = buildVideoLinkDirectPlan({
    argv: ['--video-link', 'https://www.bilibili.com/video/BV1xx411c7mD', '--cookie', 'SESSDATA=1', '--pages', '3'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'video');
  assert.deepEqual(result.input, {
    uid: '',
    videoLink: 'https://www.bilibili.com/video/BV1xx411c7mD',
    favoriteLink: '',
    pages: 3,
    hasCookie: true,
  });
  assert.deepEqual(result.collect, {
    function: 'searchVideoKeywords',
    pages: 3,
    forwardsCookie: true,
  });
  assert.deepEqual(result.training, {
    existingTermsOnly: true,
    multiagent: true,
    source: 'https://www.bilibili.com/video/BV1xx411c7mD',
    uid: '',
  });
});

test('runVideoLinkDirect delegates dry-run planning to Python by default', async () => {
  const calls = [];
  const result = await runVideoLinkDirectCommand({
    argv: ['--dry-run-plan-json', '--uid', '233', '--pages', '4'],
    runPythonPlan: async ({ argv }) => {
      calls.push(argv);
      return { ok: true, mode: 'uid', fromPython: true };
    },
    log: () => {},
    error: () => {},
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.plan, { ok: true, mode: 'uid', fromPython: true });
  assert.deepEqual(calls, [['--uid', '233', '--pages', '4']]);
});

test('runVideoLinkDirect keeps explicit JS dry-run planning fallback', async () => {
  const result = await runVideoLinkDirectCommand({
    argv: ['--dry-run-plan-json', '--js-plan', '--favorite-link', 'https://space.bilibili.com/1/favlist', '--pages', 'bad'],
    runPythonPlan: async () => {
      throw new Error('Python planner should not be called');
    },
    log: () => {},
    error: () => {},
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.plan.ok, true);
  assert.equal(result.plan.mode, 'favorite');
  assert.equal(result.plan.input.pages, 2);
  assert.equal(result.plan.collect.function, 'searchVideoKeywords');
});
