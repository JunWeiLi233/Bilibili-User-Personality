import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildKeywordHarvestQueries,
  harvestKeywordDictionary,
  readKeywordHarvestState,
  summarizeDictionaryGrowth,
  summarizeEvidenceCoverage,
} from './keywordHarvest.js';

test('buildKeywordHarvestQueries prioritizes weak-evidence dictionary terms by family', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 8 },
        { term: 'yygq', family: 'attack', evidenceCount: 5 },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: ['seed topic'],
      maxQueries: 5,
      termsPerFamily: 2,
    },
  );

  assert.deepEqual(queries, [
    'seed topic',
    '典中典 Bilibili comment meme',
    '懂的都懂 Bilibili reply argument comments',
    'yygq Bilibili comment meme',
    'doge Bilibili discussion comments',
  ]);
});

test('summarizeDictionaryGrowth reports new terms, families, and duplicates', () => {
  const summary = summarizeDictionaryGrowth(
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  );

  assert.equal(summary.before, 1);
  assert.equal(summary.after, 2);
  assert.equal(summary.added, 1);
  assert.equal(summary.duplicates, 1);
  assert.deepEqual(summary.families, { cooperation: 1, attack: 2 });
  assert.deepEqual(summary.newTerms.map((entry) => entry.term), ['yygq', 'yygq']);
});

test('summarizeEvidenceCoverage reports weak terms and family coverage', () => {
  const coverage = summarizeEvidenceCoverage(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 4 },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 2 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.equal(coverage.terms, 3);
  assert.equal(coverage.totalEvidence, 6);
  assert.equal(coverage.averageEvidence, 2);
  assert.equal(coverage.weakTerms, 2);
  assert.equal(coverage.zeroEvidenceTerms, 1);
  assert.deepEqual(coverage.weakSamples.map((entry) => entry.term), ['典中典', '懂的都懂']);
  assert.deepEqual(coverage.byFamily.attack, { terms: 1, evidence: 0, weak: 1, zero: 1 });
});

test('harvestKeywordDictionary runs dictionary-seeded searches and reports growth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-'));
  const statePath = join(dir, 'state.json');
  const dictionaries = [
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  ];
  try {
    const searched = [];
    const result = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => dictionaries.shift() || dictionaries.at(-1),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: payload.searchQueries[0] === 'seed topic' ? 'BV1111111111' : 'BV2222222222' }],
            comments: [{ rpid: payload.searchQueries[0], message: 'comment' }],
            entries: [{ term: 'yygq', family: 'attack' }],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.queries, ['seed topic', 'doge Bilibili discussion comments']);
    assert.equal(searched.length, 2);
    assert.deepEqual(searched[0], { searchQueries: ['seed topic'], discoveryLimit: 1, pages: 1, excludeBvids: [] });
    assert.equal(result.growth.added, 1);
    assert.equal(result.coverage.weakTerms, 2);
    assert.deepEqual(result.state.scannedBvids, ['BV1111111111', 'BV2222222222']);
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(persisted.runs.length, 1);
    assert.equal(persisted.runs[0].videosScanned, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary skips seen queries and videos from persistent state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-seen-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const second = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic', 'new seed'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV2222222222' }],
          comments: [],
          entries: [],
          excludeBvidsEcho: payload.excludeBvids,
        }),
      },
    );

    assert.deepEqual(second.queries, ['new seed']);
    assert.deepEqual(second.results[0].result.excludeBvidsEcho, ['BV1111111111']);
    const state = await readKeywordHarvestState(statePath);
    assert.deepEqual(state.searchedQueries, ['new seed', 'seed topic']);
    assert.deepEqual(state.scannedBvids, ['BV1111111111', 'BV2222222222']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
