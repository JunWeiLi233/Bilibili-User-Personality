#!/usr/bin/env node
// Manual inspection + restore of coverage-checkpoints snapshots.
//
// Usage:
//   node server/scripts/restoreCoverageCheckpoint.js --list
//   node server/scripts/restoreCoverageCheckpoint.js --restore <sha>
//   node server/scripts/restoreCoverageCheckpoint.js --restore-latest
//
// The harvest watchdog auto-restores on detecting corrupt live files, so this
// CLI is mainly for inspection or manual recovery outside the watchdog. It
// refuses to restore if a harvest loop appears to be running (file lock held)
// to avoid clobbering a live write.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_CHECKPOINT_BRANCH,
  listCoverageCheckpoints,
  restoreCoverageCheckpoint,
} from '../services/coverageCheckpoint.js';
import { acquireFileLock } from '../utils/fileLock.js';
import { DEFAULT_DICTIONARY_PATH } from '../services/deepseekKeywordTrainer.js';

function parseArgs(argv) {
  const args = { mode: '', sha: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--list') args.mode = 'list';
    else if (arg === '--restore-latest' || arg === '--latest') args.mode = 'latest';
    else if (arg === '--restore') {
      args.mode = 'restore';
      args.sha = String(argv[i + 1] || '');
      i += 1;
    } else if (arg.startsWith('--restore=')) {
      args.mode = 'restore';
      args.sha = arg.slice('--restore='.length);
    } else if (arg === '--help' || arg === '-h') {
      args.mode = 'help';
    }
  }
  return args;
}

function printHelp() {
  console.log('Coverage checkpoint inspection + restore');
  console.log('');
  console.log('Usage:');
  console.log('  node server/scripts/restoreCoverageCheckpoint.js --list');
  console.log('    List recent snapshots on the coverage-checkpoints branch.');
  console.log('');
  console.log('  node server/scripts/restoreCoverageCheckpoint.js --restore <sha>');
  console.log('    Restore a specific snapshot, overwriting live dictionary+state files.');
  console.log('');
  console.log('  node server/scripts/restoreCoverageCheckpoint.js --restore-latest');
  console.log('    Restore the newest snapshot.');
  console.log('');
  console.log('Refuses to restore if a harvest loop is running (dictionary lock held).');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mode || args.mode === 'help') {
    printHelp();
    process.exitCode = args.mode === 'help' ? 0 : 1;
    return;
  }

  if (args.mode === 'list') {
    const snapshots = await listCoverageCheckpoints({ branch: DEFAULT_CHECKPOINT_BRANCH, limit: 50 });
    if (snapshots.length === 0) {
      console.log('No coverage checkpoints found on branch coverage-checkpoints.');
      console.log('Snapshots are created automatically every ~20 min during the harvest loop.');
      return;
    }
    console.log(`Coverage checkpoints (newest first), ${snapshots.length} total:`);
    for (const s of snapshots) {
      const ratio = s.coverageRatio != null ? `${(s.coverageRatio * 100).toFixed(2)}%` : '?';
      const entries = s.entries != null ? s.entries : '?';
      const weak = s.weakTerms != null ? s.weakTerms : '?';
      const ts = s.timestamp ? s.timestamp.replace('T', ' ').replace(/\..*Z$/, 'Z') : '?';
      console.log(`  ${s.sha.slice(0, 8)}  ${ts}  ratio=${ratio}  entries=${entries}  weak=${weak}`);
    }
    return;
  }

  // --restore / --restore-latest
  // Refuse to restore if the harvest loop is running (lock held).
  const lockPath = `${DEFAULT_DICTIONARY_PATH}.lock`;
  let release;
  try {
    release = await acquireFileLock(lockPath, { staleMs: 60 * 1000 });
  } catch (lockError) {
    console.error(`REFUSING to restore: ${lockError.message}`);
    console.error('A harvest loop appears to be running. Stop it first, then restore.');
    process.exitCode = 1;
    return;
  }
  try {
    const snapshots = await listCoverageCheckpoints({ branch: DEFAULT_CHECKPOINT_BRANCH, limit: 50 });
    if (snapshots.length === 0) {
      console.error('No checkpoints available to restore.');
      process.exitCode = 1;
      return;
    }
    let target;
    if (args.mode === 'latest') {
      target = snapshots[0];
      console.log(`Restoring latest snapshot: ${target.sha.slice(0, 8)}`);
    } else {
      target = snapshots.find((s) => s.sha.startsWith(args.sha)) || snapshots.find((s) => s.sha === args.sha);
      if (!target) {
        console.error(`No checkpoint matching '${args.sha}'. Use --list to see available snapshots.`);
        process.exitCode = 1;
        return;
      }
      console.log(`Restoring snapshot: ${target.sha.slice(0, 8)} (${target.timestamp || '?'})`);
    }
    const result = await restoreCoverageCheckpoint({ sha: target.sha, branch: DEFAULT_CHECKPOINT_BRANCH });
    if (result.ok) {
      console.log(`Restored ${result.restored.length} path(s) from checkpoint ${result.sha.slice(0, 8)}.`);
      console.log('Live dictionary + state files overwritten. You can now restart the harvest loop.');
    } else {
      console.error(`Restore failed: ${result.error}`);
      process.exitCode = 1;
    }
  } finally {
    await release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
