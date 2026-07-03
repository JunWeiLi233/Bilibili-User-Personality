import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readKeywordHarvestState } from './keywordHarvest.js';

test('readKeywordHarvestState returns blank state for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'state-missing-'));
  try {
    const statePath = join(dir, 'state.json');
    const state = await readKeywordHarvestState(statePath);
    assert.equal(state.searchedQueries.length, 0);
    assert.equal(state.runs.length, 0);
    assert.equal(state.termAttempts && typeof state.termAttempts === 'object', true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readKeywordHarvestState falls back to .bak when live file is zeroed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'state-bak-'));
  try {
    const statePath = join(dir, 'state.json');
    const backupPath = `${statePath}.bak`;
    // Live file zeroed (power-loss symptom); .bak holds the prior good state.
    await writeFile(statePath, Buffer.alloc(100, 0));
    const goodState = {
      version: 1,
      harvestStrategyVersion: 8,
      updatedAt: '2026-07-03T00:00:00.000Z',
      searchedQueries: ['测试 评论区'],
      scannedBvids: ['BV1234'],
      termAttempts: { foo: { attempts: 2 } },
      runs: [{ at: '2026-07-03', queries: 24 }],
    };
    await writeFile(backupPath, JSON.stringify(goodState));
    const state = await readKeywordHarvestState(statePath);
    assert.equal(state.searchedQueries.length, 1);
    assert.equal(state.searchedQueries[0], '测试 评论区');
    assert.equal(state.scannedBvids[0], 'BV1234');
    assert.equal(state.runs.length, 1);
    assert.deepEqual(state.termAttempts.foo, { attempts: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readKeywordHarvestState falls back to .bak when live file is unparseable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'state-trunc-'));
  try {
    const statePath = join(dir, 'state.json');
    const backupPath = `${statePath}.bak`;
    // Live file truncated mid-write (not zeroed, just unparseable JSON).
    await writeFile(statePath, '{ "searchedQueries": [ "incomplet');
    await writeFile(backupPath, JSON.stringify({ searchedQueries: ['backup-query'], runs: [] }));
    const state = await readKeywordHarvestState(statePath);
    assert.equal(state.searchedQueries[0], 'backup-query');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readKeywordHarvestState returns blank when both live and .bak are missing/corrupt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'state-blank-'));
  try {
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, Buffer.alloc(100, 0));
    // No .bak present.
    const state = await readKeywordHarvestState(statePath);
    assert.equal(state.runs.length, 0);
    assert.equal(state.searchedQueries.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readKeywordHarvestState parses a valid live file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'state-valid-'));
  try {
    const statePath = join(dir, 'state.json');
    await writeFile(statePath, JSON.stringify({
      version: 1,
      searchedQueries: ['q1', 'q2'],
      scannedBvids: ['b1'],
      termAttempts: {},
      runs: [{ at: '2026-01-01' }],
    }));
    const state = await readKeywordHarvestState(statePath);
    assert.equal(state.searchedQueries.length, 2);
    assert.equal(state.runs.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
