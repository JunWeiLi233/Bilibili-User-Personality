import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHuggingFaceCorpusUpdate, parseHuggingFaceRows } from './huggingFaceCorpus.js';

test('parseHuggingFaceRows reads jsonl conversations from Tieba-style datasets', () => {
  const rows = parseHuggingFaceRows('{"messages":[{"role":"user","content":"贴吧原始发言"},{"role":"assistant","content":"回复忽略"}]}\n{"instruction":"查查资料再说"}', {
    dataset: 'Orphanage/Baidu_Tieba_SunXiaochuan',
    file: 'train.jsonl',
    platform: 'tieba',
    limit: 10,
  });

  assert.deepEqual(rows.map((row) => row.message), ['贴吧原始发言', '查查资料再说']);
  assert.equal(rows[0].platform, 'tieba');
  assert.match(rows[0].source, /Hugging Face dataset: Orphanage\/Baidu_Tieba_SunXiaochuan/);
});

test('parseHuggingFaceRows reads csv comment fields and filters to requested platform', () => {
  const csv = 'platform,comment,url\nbilibili,这还用说,https://www.bilibili.com/video/BV1/\nyoutube,skip me,https://youtube.example/1\n';
  const rows = parseHuggingFaceRows(csv, {
    dataset: 'honeray/ai-music-comments-1.5M',
    file: 'final_data.csv',
    platform: 'bilibili',
    limit: 10,
  });

  assert.deepEqual(rows.map((row) => row.message), ['这还用说']);
  assert.equal(rows[0].sourceUrl, 'https://www.bilibili.com/video/BV1/');
});

test('parseHuggingFaceRows reads Tieba title/detail csv rows', () => {
  const csv = [
    'title,detail,author,num_reply,href',
    '"\u4e3a\u4ec0\u4e48\u6709\u8fdb\u6b65\uff1f","\u56e0\u4e3a\u6709\u4e86\u843d\u540e\u7684\u6807\u51c6\u6240\u4ee5\u5c31\u6709\u4e86\u8fdb\u6b65","tester",2,https://tieba.baidu.com/p/8712791904',
  ].join('\n');
  const rows = parseHuggingFaceRows(csv, {
    dataset: 'kirp/ruozhiba-raw',
    file: 'wisdomBar_raw.csv',
    platform: 'tieba',
    limit: 10,
  });

  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /\u4e3a\u4ec0\u4e48\u6709\u8fdb\u6b65/);
  assert.match(rows[0].message, /\u843d\u540e\u7684\u6807\u51c6/);
  assert.equal(rows[0].sourceUrl, 'https://tieba.baidu.com/p/8712791904');
  assert.equal(rows[0].uid, 'tester');
});

test('buildHuggingFaceCorpusUpdate dedupes imported rows against existing comments', () => {
  const existing = {
    version: 1,
    comments: [{ message: '已有评论', platform: 'tieba', sourceUrl: 'hf://old' }],
    runs: [],
  };
  const update = buildHuggingFaceCorpusUpdate(existing, [
    { message: '已有评论', platform: 'tieba', sourceUrl: 'hf://old' },
    { message: '新评论', platform: 'bilibili', sourceUrl: 'hf://new' },
  ], { dataset: 'sample/dataset', file: 'data.jsonl' }, '2026-06-17T00:00:00.000Z');

  assert.equal(update.changed, true);
  assert.deepEqual(update.corpus.comments.map((row) => row.message), ['已有评论', '新评论']);
  assert.equal(update.corpus.runs[0].addedComments, 1);
});

test('parseHuggingFaceRows ignores metadata-only Bilibili rows without comment text', () => {
  const rows = parseHuggingFaceRows('{"title":"视频标题不是评论","desc":"视频简介也不是评论"}', {
    dataset: 'wencan2024/bilibili-masterpieces',
    file: 'bilibili-masterpieces-v0.jsonl',
    platform: 'bilibili',
    limit: 10,
  });

  assert.deepEqual(rows, []);
});

test('parseHuggingFaceRows ignores non-Chinese rows from mixed Hugging Face datasets', () => {
  const rows = parseHuggingFaceRows('comment\n"Where the spirit does not work with the hand, there is no art."\n这还用说\n', {
    dataset: 'mixed/comments',
    file: 'comments.csv',
    platform: 'bilibili',
    limit: 10,
  });

  assert.deepEqual(rows.map((row) => row.message), ['这还用说']);
});
