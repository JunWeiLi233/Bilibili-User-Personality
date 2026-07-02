#!/usr/bin/env node
// Opt-in watchdog: re-invokes the coverage harvest loop (runCoverageHarvestLoop.js)
// until the coverage gate passes, max restarts are exhausted, or coverage stops
// improving across runs.
//
// WHY OPT-IN: the loop script is already resilient at the cycle level — transient
// errors get retried with backoff, one-off failures skip to the next cycle, and only
// `maxConsecutiveFailures` (default 2) systemic crashes in a row kill a run. This
// wrapper adds *run-level* autonomy for long unattended sessions: after a run exits
// (whether it hit the cycle limit, the no-progress wall, or a systemic crash), it
// launches a fresh run that picks up from the checkpointed state.
//
// It does NOT run unless BILIBILI_COVERAGE_WATCHDOG_MAX_RESTARTS > 0. With the
// default (0) it executes the harvest exactly once — identical to calling the loop
// directly — so existing `npm run dictionary:auto` behavior is unchanged.
//
// No DEEPSEEK_API_KEY is read here. The child inherits env from the shell that
// launched the watchdog, which must have the key set locally (never commit it, never
// put it in CI — see CLAUDE.md).

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COVERAGE_LOOP_REPORT_PATH } from '../utils/paths.js';
import { shouldRestartRun, computeBackoffMs } from './runCoverageHarvestLoop.js';

const LOOP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runCoverageHarvestLoop.js');

function intFromEnv(name, fallback, max) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const maxRestarts = intFromEnv('BILIBILI_COVERAGE_WATCHDOG_MAX_RESTARTS', 0, 100);
const maxNoProgress = Math.max(1, intFromEnv('BILIBILI_COVERAGE_WATCHDOG_MAX_NO_PROGRESS', 2, 20));
const backoffBase = intFromEnv('BILIBILI_COVERAGE_WATCHDOG_BACKOFF_BASE_MS', 10000, 600000);
const backoffCap = intFromEnv('BILIBILI_COVERAGE_WATCHDOG_BACKOFF_CAP_MS', 300000, 3600000);
const reportPath = process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH || DEFAULT_COVERAGE_LOOP_REPORT_PATH;

const loopArgs = process.argv.slice(2);

function readReport() {
  try {
    return JSON.parse(readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

function runHarvest() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LOOP_SCRIPT, ...loopArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`Watchdog: failed to launch harvest loop: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  // Opt-in disabled: behave exactly like calling the loop directly.
  if (maxRestarts === 0) {
    process.exitCode = await runHarvest();
    return;
  }

  let restartsUsed = 0;
  let consecutiveNoProgress = 0;
  let lastCoverageRatio = -1;

  console.log(`Watchdog: up to ${maxRestarts} restart(s), stop after ${maxNoProgress} no-progress run(s).`);

  for (;;) {
    const code = await runHarvest();
    const report = readReport();

    if (!report) {
      // Child exited before writing a report — import crash, OOM, or killed.
      // Treat as no progress; the wall below stops us looping forever on a broken setup.
      consecutiveNoProgress += 1;
      console.error(`Watchdog: harvest run produced no report (exit ${code}). no-progress ${consecutiveNoProgress}/${maxNoProgress}.`);
    } else {
      const ratio = report?.finalAudit?.coverage?.coverageRatio;
      const numericRatio = typeof ratio === 'number' ? ratio : -1;
      const progressed = numericRatio > lastCoverageRatio + 1e-9;
      consecutiveNoProgress = progressed ? 0 : consecutiveNoProgress + 1;
      lastCoverageRatio = Math.max(lastCoverageRatio, numericRatio);

      console.log(`Watchdog: run finished — ok=${report.finalOk === true}, coverage=${(numericRatio * 100).toFixed(2)}%, stopReason=${report.stopReason}, no-progress ${consecutiveNoProgress}/${maxNoProgress}.`);

      if (report.finalOk === true) {
        console.log('Watchdog: coverage gate passed. Done.');
        process.exitCode = 0;
        return;
      }
    }

    if (!shouldRestartRun({ auditOk: false, restartsUsed, maxRestarts, consecutiveNoProgress, maxConsecutiveNoProgress: maxNoProgress })) {
      console.log(`Watchdog: stopping — restarts ${restartsUsed}/${maxRestarts}, no-progress ${consecutiveNoProgress}/${maxNoProgress}, last coverage ${((lastCoverageRatio < 0 ? 0 : lastCoverageRatio) * 100).toFixed(2)}%.`);
      process.exitCode = 1;
      return;
    }

    restartsUsed += 1;
    const wait = computeBackoffMs(restartsUsed, backoffBase, backoffCap);
    console.log(`Watchdog: restart ${restartsUsed}/${maxRestarts} after ${Math.round(wait / 1000)}s backoff...`);
    await sleep(wait);
  }
}

// Guard: only run when invoked directly, not when imported (e.g. by a future test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
