import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTiebaCorpusUpdate } from './tiebaCorpus.js';

test('buildTiebaCorpusUpdate leaves corpus unchanged when a run adds no comments', () => {
  const existing = {
    version: 1,
    updatedAt: '2026-06-17T00:00:00.000Z',
    runs: [
      {
        at: '2026-06-17T00:00:00.000Z',
        queries: ['无敌可爱'],
        results: [{ query: '无敌可爱', comments: [{ message: '旧评论', sourceUrl: 'https://tieba.baidu.com/p/1' }] }],
      },
    ],
    comments: [
      {
        message: '旧评论',
        sourceUrl: 'https://tieba.baidu.com/p/1',
        rpid: 'tieba-1',
      },
    ],
  };
  const blockedRun = {
    at: '2026-06-17T01:00:00.000Z',
    queries: ['德里不饶人'],
    results: [{ query: '德里不饶人', comments: [], warnings: ['Tieba safety verification page returned'] }],
    warnings: ['德里不饶人: Tieba safety verification page returned'],
  };

  const update = buildTiebaCorpusUpdate(existing, blockedRun, '2026-06-17T01:00:00.000Z');

  assert.equal(update.changed, false);
  assert.deepEqual(update.corpus, existing);
});
