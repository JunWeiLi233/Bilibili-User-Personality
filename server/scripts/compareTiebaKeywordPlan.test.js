import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareTiebaKeywordPlan, compareTiebaKeywordPlanObjects } from './compareTiebaKeywordPlan.js';

const OPTIONS = {
  queries: ['懂的都懂', '贴吧梗'],
  threadUrls: ['https://tieba.baidu.com/p/123456'],
  actionFile: 'actions.json',
  outputPath: 'tieba.json',
  maxQueries: 2,
  forumPages: 2,
  threadLimit: 3,
  threadPages: 4,
  minDelayMs: 100,
  jitterMs: 50,
  blockCooldownMs: 1000,
  requestTimeoutMs: 5000,
  overallTimeoutMs: 6000,
  discoveryMode: 'mobile',
  includeDiscoveryTitles: true,
  discoveryTitlesOnly: true,
  train: true,
  existingTermsOnly: false,
};

test('compareTiebaKeywordPlanObjects reports matching options only', () => {
  const result = compareTiebaKeywordPlanObjects({ ok: true, options: OPTIONS, ignored: true }, { ok: true, options: OPTIONS, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, { options: OPTIONS });
  assert.deepEqual(result.js, { options: OPTIONS });
});

test('compareTiebaKeywordPlan compares JS and Python dry-run option plans', async () => {
  const calls = [];
  const result = await compareTiebaKeywordPlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, options: OPTIONS };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, options: OPTIONS };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareTiebaKeywordPlan covers Python corpus update env option', async () => {
  const result = await compareTiebaKeywordPlan({
    payload: {
      env: {
        TIEBA_USE_PYTHON_CORPUS_UPDATE: '1',
      },
      argv: ['--query=doge'],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.js.options.usePythonCorpusUpdate, true);
  assert.equal(result.python.options.usePythonCorpusUpdate, true);
});
