// Power-loss-safe coverage checkpointing via a dedicated git branch.
//
// WHY: harvested dictionary/state files live only on disk between commits, and
// a power-loss can zero them (the corruption we hit). The harvest watchdog
// handles process crashes but cannot recover lost bytes. This module snapshots
// the live dictionary + harvest state to a `coverage-checkpoints` git branch
// every ~20 min. Git objects are write-once and fsync'd by git itself, so the
// snapshot survives power-loss. On corruption, the watchdog auto-restores the
// latest snapshot before relaunching the loop.
//
// HOW (the key trick): we do NOT switch branches (that would disrupt the live
// working tree and the running harvest). Instead we stage the dictionary files,
// build a tree from the index with `git write-tree`, commit it as a child of the
// checkpoint branch's current tip with `git commit-tree`, and advance the ref
// with `git update-ref`. HEAD and the feature branch stay completely untouched.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_CHECKPOINT_BRANCH = 'coverage-checkpoints';
export const DEFAULT_CHECKPOINT_PATHS = [
  'server/data/deepseekKeywordDictionary.json',
  'server/data/deepseekKeywordDictionary.entries',
  'server/data/deepseekKeywordDictionary.evidence',
  'server/data/keywordHarvestState.json',
  'server/data/keywordHarvestState.json.bak',
];
export const DEFAULT_MAX_SNAPSHOTS = 72; // ~24h at 20-min intervals

async function git(args, { cwd, captureStderr = false } = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 50 * 1024 * 1024,
  });
  if (captureStderr) return { stdout: stdout.toString(), stderr: stderr.toString() };
  return stdout.toString();
}

function isGitRepo(cwd) {
  return git(['rev-parse', '--git-dir'], { cwd })
    .then(() => true)
    .catch(() => false);
}

/** Read the coverage snapshot metadata embedded in a checkpoint commit message. */
function parseCheckpointMessage(message) {
  const lines = String(message || '').split('\n');
  const meta = { coverageRatio: null, entries: null, weakTerms: null, timestamp: null };
  for (const line of lines) {
    const m = line.match(/^coverage-checkpoint ratio=([0-9.]+) entries=(\d+) weak=(\d+) ts=(\S+)/);
    if (m) {
      meta.coverageRatio = Number(m[1]);
      meta.entries = Number(m[2]);
      meta.weakTerms = Number(m[3]);
      meta.timestamp = m[4];
    }
  }
  return meta;
}

/**
 * Create a checkpoint snapshot of the live dictionary + harvest state on the
 * dedicated checkpoint branch. Does NOT touch HEAD or the working branch.
 *
 * @param {object} options
 * @param {string} [options.cwd] - Repo root (defaults to process.cwd()).
 * @param {string} [options.branch] - Checkpoint branch name.
 * @param {string[]} [options.paths] - Repo-relative paths to snapshot.
 * @param {object} [options.meta] - Extra metadata { coverageRatio, entries, weakTerms }.
 * @returns {Promise<{ok:true, sha:string, parent:string|null, message:string}|{ok:false, error:string}>}
 */
export async function createCoverageCheckpoint({
  cwd = process.cwd(),
  branch = DEFAULT_CHECKPOINT_BRANCH,
  paths = DEFAULT_CHECKPOINT_PATHS,
  meta = {},
} = {}) {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, error: 'not a git repository' };
  }
  // Snapshot the current index so we can restore it (we stage only our paths,
  // then build a tree, then unstage — leaving the user's index as we found it).
  let indexBackupTree = '';
  try {
    indexBackupTree = (await git(['write-tree'], { cwd })).trim();
  } catch {
    // Empty/uninitialized index is fine — we'll just stage our paths.
    indexBackupTree = '';
  }

  try {
    // Stage ONLY the dictionary + state paths. --force because the files are in
    // .gitignore'd-by-policy data dirs (AGENTS.md §5.1) yet must reach this one
    // checkpoint branch. We never commit them to the feature branch. Add each
    // path individually so a missing optional path (e.g. .bak not yet created)
    // doesn't abort the whole snapshot.
    let stagedAny = false;
    for (const p of paths) {
      try {
        await git(['add', '--force', '--', p], { cwd });
        stagedAny = true;
      } catch {
        // Path doesn't exist (e.g. .bak not created yet) — skip.
      }
    }
    if (!stagedAny) {
      return { ok: false, error: 'no checkpoint paths existed to stage' };
    }

    const treeSha = (await git(['write-tree'], { cwd })).trim();

    // Resolve the checkpoint branch tip (may not exist yet on first snapshot).
    let parentSha = '';
    try {
      parentSha = (await git(['rev-parse', '--verify', `refs/heads/${branch}`], { cwd })).trim();
    } catch {
      parentSha = ''; // first checkpoint — orphan root
    }

    const timestamp = new Date().toISOString();
    const ratio = Number(meta.coverageRatio);
    const entries = Number(meta.entries);
    const weak = Number(meta.weakTerms);
    const message =
      `coverage-checkpoint ${timestamp}\n` +
      `coverage-checkpoint ratio=${Number.isFinite(ratio) ? ratio.toFixed(4) : '0'} ` +
      `entries=${Number.isFinite(entries) ? entries : 0} ` +
      `weak=${Number.isFinite(weak) ? weak : 0} ` +
      `ts=${timestamp}`;

    const commitArgs = ['commit-tree', treeSha, '-m', message];
    if (parentSha) commitArgs.push('-p', parentSha);
    const commitSha = (await git(commitArgs, { cwd })).trim();

    // Advance the checkpoint branch ref to the new commit. HEAD/feature branch untouched.
    await git(['update-ref', `refs/heads/${branch}`, commitSha, parentSha || ''], { cwd });

    return { ok: true, sha: commitSha, parent: parentSha || null, message, tree: treeSha };
  } finally {
    // Restore the index to its pre-checkpoint state so we don't leave the
    // dictionary files staged for the user's next feature-branch commit.
    if (indexBackupTree) {
      try {
        await git(['read-tree', indexBackupTree], { cwd });
      } catch {
        // best-effort restore; a stale index entry is harmless (the user's next
        // `git status` will show the data files as unstaged-modified again)
      }
    } else {
      for (const p of paths) {
        try { await git(['reset', '-q', '--', p], { cwd }); } catch {}
      }
    }
  }
}

/**
 * Walk the checkpoint branch history and return recent snapshots (newest first).
 * @returns {Promise<Array<{sha, parent, timestamp, coverageRatio, entries, weakTerms}>>}
 */
export async function listCoverageCheckpoints({
  cwd = process.cwd(),
  branch = DEFAULT_CHECKPOINT_BRANCH,
  limit = 50,
} = {}) {
  if (!(await isGitRepo(cwd))) return [];
  let logOutput = '';
  try {
    logOutput = await git([
      'log',
      `--max-count=${Math.min(Math.max(1, Number(limit) || 50), 500)}`,
      '--format=%H%x09%P%x09%B%x00', // sha \t parent \t body \0
      `refs/heads/${branch}`,
    ], { cwd });
  } catch {
    return []; // branch doesn't exist yet
  }
  const records = logOutput.split('\0').map((r) => r.trim()).filter(Boolean);
  const snapshots = [];
  for (const record of records) {
    const [shaRaw, parentRaw, ...bodyParts] = record.split('\t');
    const body = bodyParts.join('\t').trim();
    const meta = parseCheckpointMessage(body);
    snapshots.push({
      sha: String(shaRaw || '').trim(),
      parent: String(parentRaw || '').trim() || null,
      timestamp: meta.timestamp,
      coverageRatio: meta.coverageRatio,
      entries: meta.entries,
      weakTerms: meta.weakTerms,
    });
  }
  return snapshots;
}

/**
 * Restore a checkpoint snapshot's dictionary + state files into the working
 * tree, overwriting live files. Does NOT switch the feature branch. Caller must
 * ensure the harvest loop is NOT running (no concurrent writes).
 *
 * @param {object} options
 * @param {string} options.sha - Checkpoint commit SHA to restore.
 * @returns {Promise<{ok:true, sha:string, restored:string[]}|{ok:false, error:string}>}
 */
export async function restoreCoverageCheckpoint({
  cwd = process.cwd(),
  branch = DEFAULT_CHECKPOINT_BRANCH,
  sha,
  paths = DEFAULT_CHECKPOINT_PATHS,
} = {}) {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, error: 'not a git repository' };
  }
  const targetSha = sha ? String(sha).trim() : null;
  let restoreSha = targetSha;
  if (!restoreSha) {
    try {
      restoreSha = (await git(['rev-parse', `refs/heads/${branch}`], { cwd })).trim();
    } catch {
      return { ok: false, error: `no checkpoint branch ${branch} and no sha given` };
    }
  }
  // Verify the commit exists.
  try {
    await git(['cat-file', '-t', restoreSha], { cwd });
  } catch {
    return { ok: false, error: `commit ${restoreSha} not found` };
  }
  // Check out each path from the snapshot into the working tree. `git checkout
  // <sha> -- <path>` writes the snapshot's version of the file to the working
  // tree + index without touching HEAD.
  for (const p of paths) {
    try {
      await git(['checkout', restoreSha, '--', p], { cwd });
    } catch {
      // Path may not exist in this snapshot (e.g. .bak added later) — skip.
    }
  }
  return { ok: true, sha: restoreSha, restored: paths };
}

/**
 * Bound the checkpoint branch history. Because git commits are immutable and
 * linearly linked, we cannot surgically drop the middle of a branch without
 * rewriting. Instead, when history exceeds 2x the cap, we rebuild the branch
 * as a fresh chain of only the most recent `maxSnapshots` snapshots (re-creating
 * each commit with `commit-tree` so the new chain is self-contained). The old
 * commits become unreachable and are reclaimed by a later `git gc`.
 */
export async function pruneOldCheckpoints({
  cwd = process.cwd(),
  branch = DEFAULT_CHECKPOINT_BRANCH,
  maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
} = {}) {
  const keep = Math.max(1, Number(maxSnapshots) || DEFAULT_MAX_SNAPSHOTS);
  const snapshots = await listCoverageCheckpoints({ cwd, branch, limit: keep + 100 });
  if (snapshots.length <= keep * 2) {
    // Not yet over the 2x threshold — leave the linear branch alone (cheap).
    return { ok: true, pruned: 0, kept: snapshots.length };
  }
  // Rebuild a fresh chain from the most recent `keep` snapshots (newest-first).
  // We re-create each tree as a new commit so the rebuilt branch references
  // only these commits; the old chain becomes unreachable.
  const toKeep = snapshots.slice(0, keep).reverse(); // oldest-of-kept first → newest last
  let parentSha = '';
  const newCommits = [];
  for (const snap of toKeep) {
    // Read the tree of the original commit, re-commit it on the new chain.
    const treeSha = (await git(['rev-parse', `${snap.sha}^{tree}`], { cwd })).trim();
    const message =
      `coverage-checkpoint ${snap.timestamp || ''}\n` +
      `coverage-checkpoint ratio=${snap.coverageRatio != null ? Number(snap.coverageRatio).toFixed(4) : '0'} ` +
      `entries=${snap.entries != null ? snap.entries : 0} ` +
      `weak=${snap.weakTerms != null ? snap.weakTerms : 0} ` +
      `ts=${snap.timestamp || ''}`;
    const commitArgs = ['commit-tree', treeSha, '-m', message];
    if (parentSha) commitArgs.push('-p', parentSha);
    parentSha = (await git(commitArgs, { cwd })).trim();
    newCommits.push(parentSha);
  }
  if (parentSha) {
    await git(['update-ref', `refs/heads/${branch}`, parentSha], { cwd });
  }
  return { ok: true, pruned: snapshots.length - keep, kept: keep, newTip: parentSha };
}

/** Detect whether the live dictionary manifest is zeroed/corrupt (the power-loss symptom). */
export async function isDictionaryCorrupt(dictionaryPath) {
  try {
    const data = await readFile(dictionaryPath);
    if (!data || data.length === 0) return true;
    const sample = data.subarray(0, Math.min(200, data.length));
    if (sample.every((byte) => byte === 0)) return true;
    JSON.parse(data); // throws on truncation/garbage
    return false;
  } catch {
    return true;
  }
}
