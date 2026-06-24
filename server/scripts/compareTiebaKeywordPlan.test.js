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
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareTiebaKeywordPlan delegates saved JS option plan comparison to Python contract', async () => {
  const calls = [];
  const result = await compareTiebaKeywordPlan({
    runJs: async (context) => {
      calls.push({ js: context.payloadPath.endsWith('payload.json') });
      return { ok: true, options: { queries: ['stale'], maxQueries: 1 } };
    },
    runPython: async (context) => {
      calls.push({ python: context.payloadPath.endsWith('payload.json') });
      return { ok: true, options: { queries: ['doge'], maxQueries: 3 } };
    },
    runCompare: async (context) => {
      calls.push({
        compare: context.payloadPath.endsWith('payload.json'),
        hasJsReportPath: context.jsReportPath.endsWith('js-report.json'),
        jsQueries: context.jsReport.options.queries,
        pythonQueries: context.pythonReport.options.queries,
      });
      return {
        ok: false,
        mismatches: [
          {
            key: 'options',
            python: { queries: ['doge'], maxQueries: 3 },
            js: { queries: ['stale'], maxQueries: 1 },
          },
        ],
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'options',
      python: { queries: ['doge'], maxQueries: 3 },
      js: { queries: ['stale'], maxQueries: 1 },
    },
  ]);
  assert.deepEqual(calls, [
    { js: true },
    { python: true },
    {
      compare: true,
      hasJsReportPath: true,
      jsQueries: ['stale'],
      pythonQueries: ['doge'],
    },
  ]);
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

test('compareTiebaKeywordPlan covers explicit thread URL scrape fixtures', async () => {
  const result = await compareTiebaKeywordPlan({
    scrapePayload: {
      keyword: 'explicit',
      threadUrls: ['https://c.tieba.baidu.com/p/10759170700?lp=home_main_thread_pb&mo_device=1'],
      threadHtmlById: {
        10759170700:
          '<div class="l_post" data-field=\'{"content":{"post_id":"9"},"author":{"user_name":"carol"}}\'><div class="d_post_content">mobile explicit thread comment</div></div>',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scrape.ok, true);
  assert.deepEqual(result.scrape.mismatches, []);
  assert.deepEqual(result.scrape.python.threadIds, ['10759170700']);
  assert.deepEqual(result.scrape.python.commentMessages, ['mobile explicit thread comment']);
});

test('compareTiebaKeywordPlan covers provided thread scrape fixtures', async () => {
  const result = await compareTiebaKeywordPlan({
    scrapePayload: {
      keyword: 'provided',
      threads: [
        {
          id: '2222222222',
          kind: 'tieba-thread',
          title: 'Provided thread',
          keyword: 'provided',
          sourceUrl: 'https://tieba.baidu.com/p/2222222222',
          fetchUrl: 'https://tieba.baidu.com/p/2222222222?pn=1',
        },
      ],
      threadHtmlById: {
        2222222222:
          '<div class="l_post" data-field=\'{"content":{"post_id":"12"},"author":{"user_name":"dave"}}\'><div class="d_post_content">provided thread comment</div></div>',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scrape.ok, true);
  assert.deepEqual(result.scrape.mismatches, []);
  assert.deepEqual(result.scrape.python.threadIds, ['2222222222']);
  assert.deepEqual(result.scrape.python.commentMessages, ['provided thread comment']);
});
