import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  createCoverageCheckpoint,
  listCoverageCheckpoints,
  restoreCoverageCheckpoint,
  pruneOldCheckpoints,
  isDictionaryCorrupt,
  DEFAULT_CHECKPOINT_BRANCH,
} from './coverageCheckpoint.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ckpt-unit-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@test'], dir);
  git(['config', 'user.name', 'test'], dir);
  await mkdir(join(dir, 'server/data/deepseekKeywordDictionary.entries'), { recursive: true });
  await mkdir(join(dir, 'server/data/deepseekKeywordDictionary.evidence'), { recursive: true });
  await writeFile(join(dir, 'server/data/deepseekKeywordDictionary.json'), JSON.stringify({ entries: [{ term: 'original' }] }));
  await writeFile(join(dir, 'server/data/keywordHarvestState.json'), JSON.stringify({ runs: [] }));
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'base'], dir);
  return dir;
}

test('createCoverageCheckpoint writes to the checkpoint branch without moving HEAD', async () => {
  const dir = await makeRepo();
  try {
    const headBefore = git(['rev-parse', 'HEAD'], dir).trim();
    const branchBefore = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
    const result = await createCoverageCheckpoint({
      cwd: dir,
      meta: { coverageRatio: 0.5, entries: 100, weakTerms: 50 },
    });
    assert.equal(result.ok, true);
    assert.ok(result.sha);
    const headAfter = git(['rev-parse', 'HEAD'], dir).trim();
    const branchAfter = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
    assert.equal(headAfter, headBefore, 'HEAD must not move');
    assert.equal(branchAfter, branchBefore, 'feature branch must not switch');
    // checkpoint branch exists and points at the new commit
    const refSha = git(['rev-parse', `refs/heads/${DEFAULT_CHECKPOINT_BRANCH}`], dir).trim();
    assert.equal(refSha, result.sha);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listCoverageCheckpoints returns parsed metadata newest-first', async () => {
  const dir = await makeRepo();
  try {
    await createCoverageCheckpoint({ cwd: dir, meta: { coverageRatio: 0.5, entries: 100, weakTerms: 50 } });
    await createCoverageCheckpoint({ cwd: dir, meta: { coverageRatio: 0.6, entries: 110, weakTerms: 40 } });
    const list = await listCoverageCheckpoints({ cwd: dir });
    assert.equal(list.length, 2);
    assert.equal(list[0].coverageRatio, 0.6, 'newest first');
    assert.equal(list[1].coverageRatio, 0.5);
    assert.equal(list[0].entries, 110);
    assert.ok(list[0].timestamp, 'timestamp parsed from message');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restoreCoverageCheckpoint overwrites corrupt live files', async () => {
  const dir = await makeRepo();
  try {
    const ckpt = await createCoverageCheckpoint({ cwd: dir, meta: { coverageRatio: 0.5, entries: 100, weakTerms: 50 } });
    // Corrupt the live manifest (the power-loss symptom).
    const dictPath = join(dir, 'server/data/deepseekKeywordDictionary.json');
    await writeFile(dictPath, Buffer.alloc(100, 0));
    assert.equal(await isDictionaryCorrupt(dictPath), true);
    const result = await restoreCoverageCheckpoint({ cwd: dir, sha: ckpt.sha });
    assert.equal(result.ok, true);
    const restored = JSON.parse(await readFile(dictPath, 'utf8'));
    assert.deepEqual(restored.entries[0], { term: 'original' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isDictionaryCorrupt detects zeroed and truncated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'corrupt-'));
  try {
    const zeroed = join(dir, 'zero.json');
    const truncated = join(dir, 'trunc.json');
    const valid = join(dir, 'valid.json');
    await writeFile(zeroed, Buffer.alloc(50, 0));
    await writeFile(truncated, '{ "entries": ['); // truncated mid-write
    await writeFile(valid, JSON.stringify({ entries: [] }));
    assert.equal(await isDictionaryCorrupt(zeroed), true, 'zeroed detected');
    assert.equal(await isDictionaryCorrupt(truncated), true, 'truncated detected');
    assert.equal(await isDictionaryCorrupt(valid), false, 'valid not flagged');
    // Missing file counts as corrupt (needs restore).
    assert.equal(await isDictionaryCorrupt(join(dir, 'missing.json')), true, 'missing detected');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pruneOldCheckpoints bounds the branch history to maxSnapshots', async () => {
  const dir = await makeRepo();
  try {
    // Create 8 checkpoints (exceeds 2x cap of 3 → triggers prune).
    for (let i = 0; i < 8; i += 1) {
      await createCoverageCheckpoint({ cwd: dir, meta: { coverageRatio: 0.5 + i * 0.01, entries: 100 + i, weakTerms: 50 - i } });
    }
    const before = await listCoverageCheckpoints({ cwd: dir });
    const result = await pruneOldCheckpoints({ cwd: dir, maxSnapshots: 3 });
    const after = await listCoverageCheckpoints({ cwd: dir });
    assert.equal(result.pruned, 8 - 3);
    assert.equal(after.length, 3, 'history bounded to maxSnapshots');
    // The newest snapshot is preserved.
    assert.equal(after[0].entries, before[0].entries);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createCoverageCheckpoint returns ok:false when not a git repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notgit-'));
  try {
    const result = await createCoverageCheckpoint({ cwd: dir });
    assert.equal(result.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
