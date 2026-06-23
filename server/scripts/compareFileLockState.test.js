import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FILE_LOCK_STATE_FIXTURES, compareFileLockState, compareFileLockStateObjects } from './compareFileLockState.js';

const SUMMARY = {
  owner: { pid: 999999, startedAt: '2026-06-19T00:00:00.000Z', command: 'node fixture' },
  state: { exists: true, hasOwner: true, staleByAge: true, staleByPid: true, stale: true, shouldRemove: true },
};

test('compareFileLockStateObjects reports matching lock state summaries', () => {
  const result = compareFileLockStateObjects({ ok: true, ...SUMMARY, lockPath: 'ignored' }, { ok: true, ...SUMMARY });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.python, SUMMARY);
  assert.deepEqual(result.js, SUMMARY);
});

test('compareFileLockState compares JS-compatible and Python lock reports', async () => {
  const calls = [];
  const result = await compareFileLockState({
    owner: SUMMARY.owner,
    runJs: async (context) => {
      calls.push({ js: context.lockPath.endsWith('.fixture.lock') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.lockPath.endsWith('.fixture.lock') });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [{ js: true }, { python: true }]);
});

test('compareFileLockState exports named file-backed fixtures', async () => {
  assert.deepEqual(Object.keys(FILE_LOCK_STATE_FIXTURES), ['stale-owner', 'missing-owner', 'corrupt-owner']);

  const calls = [];
  const result = await compareFileLockState({
    fixtureNames: Object.keys(FILE_LOCK_STATE_FIXTURES),
    runJs: async (context) => {
      calls.push({ js: context.fixture.name, hasLockPath: context.lockPath.endsWith('.fixture.lock') });
      return { ok: true, ...SUMMARY };
    },
    runPython: async (context) => {
      calls.push({ python: context.fixture.name, hasLockPath: context.lockPath.endsWith('.fixture.lock') });
      return { ok: true, ...SUMMARY };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(calls, [
    { js: 'stale-owner', hasLockPath: true },
    { python: 'stale-owner', hasLockPath: true },
    { js: 'missing-owner', hasLockPath: true },
    { python: 'missing-owner', hasLockPath: true },
    { js: 'corrupt-owner', hasLockPath: true },
    { python: 'corrupt-owner', hasLockPath: true },
  ]);
});
