import assert from 'node:assert/strict';
import test from 'node:test';

import { compareVideoLinkDirectPlan, compareVideoLinkDirectPlanObjects, compareVideoLinkDirectPlanSuite } from './compareVideoLinkDirectPlan.js';

test('compareVideoLinkDirectPlanObjects reports matching direct-link plans', () => {
  const plan = {
    ok: true,
    mode: 'video',
    input: { videoLink: 'https://www.bilibili.com/video/BV1', pages: 2, hasCookie: false },
    collect: { function: 'searchVideoKeywords', pages: 2, forwardsCookie: false },
    training: { existingTermsOnly: true, multiagent: true, source: 'https://www.bilibili.com/video/BV1', uid: '' },
  };

  assert.deepEqual(compareVideoLinkDirectPlanObjects(plan, plan), {
    ok: true,
    mismatches: [],
    python: {
      mode: 'video',
      input: plan.input,
      collect: plan.collect,
      training: plan.training,
    },
    js: {
      mode: 'video',
      input: plan.input,
      collect: plan.collect,
      training: plan.training,
    },
  });
});

test('compareVideoLinkDirectPlan compares JS and Python dry-run plans', async () => {
  const result = await compareVideoLinkDirectPlan({
    payload: {
      argv: ['--uid', '233', '--cookie', 'SESSDATA=1', '--pages', '4'],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.js.mode, 'uid');
  assert.equal(result.python.mode, 'uid');
  assert.equal(result.python.input.hasCookie, true);
});

test('compareVideoLinkDirectPlanSuite covers direct video, favorite, uid, and missing target fixtures', async () => {
  const result = await compareVideoLinkDirectPlanSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['video', 'favorite', 'uid', 'missing-target']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'favorite').python.mode, 'favorite');
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'missing-target').python.error, 'missing-target');
});
