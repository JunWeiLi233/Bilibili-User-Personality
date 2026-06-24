import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { compareAicuScrapePlan, compareAicuScrapePlanObjects, compareAicuScrapePlanSuite } from './compareAicuScrapePlan.js';

const PLAN = {
  uids: ['123456', '789012'],
  requests: [
    {
      uid: '123456',
      commentPages: 10,
      danmakuPages: 10,
      commentsUrl: 'https://api.aicu.cc/api/v3/search/getreply?uid=123456&pn=1&ps=20&mode=0&keyword=',
      danmakuUrl: 'https://api.aicu.cc/api/v3/search/getvideodm?uid=123456&pn=1&ps=20&keyword=',
    },
  ],
  summary: {
    uids: 2,
    commentPagesPerUid: 10,
    danmakuPagesPerUid: 10,
    delayBetweenUidsMs: 15000,
  },
};

test('compareAicuScrapePlanObjects reports matching scrape plan summaries', () => {
  const result = compareAicuScrapePlanObjects({ ok: true, ...PLAN, ignored: true }, { ok: true, ...PLAN, ignored: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, PLAN);
  assert.deepEqual(result.js, PLAN);
});

test('compareAicuScrapePlan compares JS and Python dry-run scrape plans', async () => {
  const calls = [];
  const result = await compareAicuScrapePlan({
    runJs: async (payload) => {
      calls.push({ js: payload });
      return { ok: true, ...PLAN };
    },
    runPython: async (payload) => {
      calls.push({ python: payload });
      return { ok: true, ...PLAN };
    },
    runCompare: async () => ({ ok: true, mismatches: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(calls.length, 2);
});

test('compareAicuScrapePlan delegates saved JS report comparison to Python contract', async () => {
  let compareContext;
  const jsReport = { ok: true, ...PLAN };
  const pythonReport = { ok: true, ...PLAN };
  const result = await compareAicuScrapePlan({
    runJs: async () => jsReport,
    runPython: async () => pythonReport,
    runCompare: async (context) => {
      compareContext = context;
      return { ok: true, mismatches: [], python: PLAN, js: PLAN };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(compareContext.jsReportPath.endsWith('js-report.json'), true);
  assert.deepEqual(compareContext.jsReport, jsReport);
  assert.deepEqual(compareContext.pythonReport, pythonReport);
});

test('compareAicuScrapePlanSuite covers inline, missing-file, and page override fixtures', async () => {
  const result = await compareAicuScrapePlanSuite();

  assert.equal(result.ok, true);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.name), ['inline-dedupe', 'missing-file', 'page-overrides']);
  assert.deepEqual(result.fixtures.flatMap((fixture) => fixture.mismatches), []);
  assert.deepEqual(result.fixtures.find((fixture) => fixture.name === 'missing-file').python.uids, []);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'page-overrides').python.summary.commentPagesPerUid, 4);
  assert.equal(result.fixtures.find((fixture) => fixture.name === 'page-overrides').python.requests[0].commentsUrl.includes('ps=8'), true);
});

test('compareAicuScrapePlan keeps separated uid and file arguments compatible with Python', async () => {
  const result = await compareAicuScrapePlan({
    payload: {
      argv: ['--uid', '123', '--file', 'server/data/does-not-exist-aicu-separated-uids.txt', 'https://space.bilibili.com/456'],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.js.uids, ['123', '456']);
  assert.deepEqual(result.python.uids, ['123', '456']);
});

test('compareAicuScrapePlan keeps whitespace and fullwidth file delimiters compatible with Python', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'aicu-delimiter-plan-'));
  try {
    const uidFilePath = join(tempDir, 'uids.txt');
    await writeFile(uidFilePath, '123 456\uff0c789\uff1bhttps://space.bilibili.com/999', 'utf8');
    const result = await compareAicuScrapePlan({
      payload: {
        argv: [`--file=${uidFilePath}`],
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.mismatches, []);
    assert.deepEqual(result.js.uids, ['123', '456', '789', '999']);
    assert.deepEqual(result.python.uids, ['123', '456', '789', '999']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
