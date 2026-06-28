#!/usr/bin/env node
/**
 * Stop Hook Hub — single resilient orchestrator for ALL stop-time checks.
 *
 * Replaces the two separate stop hooks (stop-goal-check + agent-lock cleanup)
 * with ONE process that:
 *   1. Always outputs valid {decision, reason} JSON to stdout, even on crash
 *   2. Routes ALL diagnostics to stderr
 *   3. Handles uncaught exceptions / unhandled rejections as safety nets
 *
 * Why: multiple separate hook processes multiply the chance of any one
 * producing non-JSON stdout (empty output from a crashed process, Node.js
 * startup errors, path resolution failures, etc.). A single process with
 * defense-in-depth eliminates that failure mode.
 */

const fs = require('node:fs');
const path = require('node:path');

// ── Safety nets: catch ANY uncaught error and still emit valid JSON ──────
let _emitted = false;
function safeEmit(decision, reason) {
  if (_emitted) return;
  _emitted = true;
  // Use fs.writeSync(fd=1) — guaranteed synchronous, no buffering/async-drain
  // race. process.stdout.write() can buffer and process.exit() may truncate.
  try {
    fs.writeSync(1, JSON.stringify({ decision, reason }) + '\n');
  } catch {
    // fd 1 closed or broken — nothing we can do. Exit silently.
  }
  process.exit(decision === 'block' ? 2 : 0);
}

process.on('uncaughtException', (err) => {
  if (!_emitted) {
    try { fs.writeSync(2, 'STOP-HUB FATAL: ' + (err?.message || err) + '\n'); } catch {}
  }
  safeEmit('approve', 'hub crash (non-fatal): ' + (err?.message || 'unknown'));
});

process.on('unhandledRejection', (reason) => {
  if (!_emitted) {
    try { fs.writeSync(2, 'STOP-HUB REJECTION: ' + (reason?.message || reason) + '\n'); } catch {}
  }
  // Don't emit here — the rejection might be handled. If it causes an
  // uncaughtException, that handler will emit. If not, we continue normally.
});

// ── Utility ──────────────────────────────────────────────────────────────
function loadJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// CHECK 1: Goal / Coverage / Task completion
// (ported from stop-goal-check.cjs)
// ══════════════════════════════════════════════════════════════════════════

function isTaskComplete(cfg, cwd) {
  const progressFile = cfg.progressFile;
  if (!progressFile) return true;

  const pp = path.join(cwd, progressFile);
  const progress = loadJson(pp);
  if (!progress) return false;

  if (progress.done === true) return true;

  if (cfg.type === 'bilibili-seed-scrape') {
    const rounds = cfg.rounds || [];
    const scrapeRounds = rounds.filter(r => r.type !== 'harvest');
    const harvestRound = rounds.find(r => r.type === 'harvest');
    const allScrapeDone = scrapeRounds.every(r => progress[`round_${r.id}_done`] === true);
    const harvestDone = !harvestRound || progress.harvest_done === true;
    return allScrapeDone && harvestDone;
  }

  if (cfg.type === 'bilibili-keyword-search') {
    return progress.keyword_search_done === true;
  }

  if (cfg.type === 'bilibili-danmaku-deep') {
    return progress.danmaku_deep_done === true;
  }

  if (cfg.type === 'tieba-keyword-scrape') {
    const total = cfg.totalItems || 0;
    const done = (progress.completed || []).length + (progress.blocked || []).length;
    return total > 0 && done >= total;
  }

  const total = cfg.totalItems || 0;
  if (total > 0) {
    const done = (progress.completed || []).length + (progress.blocked || []).length;
    return done >= total;
  }

  return false;
}

function taskStatusLine(cfg, cwd) {
  const pp = path.join(cwd, cfg.progressFile || '');
  const progress = loadJson(pp);
  const complete = isTaskComplete(cfg, cwd);

  let detail = '';
  if (!progress) {
    detail = 'NOT STARTED';
  } else if (complete) {
    detail = 'DONE';
  } else {
    const done = (progress.completed || []).length;
    const total = cfg.totalItems || '?';
    const roundInfo = [];
    for (const r of cfg.rounds || []) {
      if (r.type === 'harvest') continue;
      if (progress[`round_${r.id}_done`]) roundInfo.push(`R${r.id}✓`);
      else roundInfo.push(`R${r.id}…`);
    }
    detail = roundInfo.length > 0 ? roundInfo.join(' ') : `${done}/${total}`;
  }

  return `${complete ? '✅' : '🔄'} ${cfg.name}: ${detail}`;
}

function runGoalCheck(cwd) {
  // Read hook input from stdin
  let event = {};
  try {
    const buf = fs.readFileSync(0, 'utf8');
    if (buf && buf.trim()) event = JSON.parse(buf);
  } catch { /* empty stdin — not a hook invocation */ }

  const isStop = event.hook_event_name === 'Stop' || event.event === 'stop';

  const goalFile = path.join(cwd, '.claude', '.goal_active');
  const hasGoal = fs.existsSync(goalFile);

  if (!isStop || !hasGoal) {
    return { decision: 'approve', reason: 'no active goal', skipRest: true };
  }

  const issues = [];

  // Coverage check
  const auditPath = path.join(cwd, 'server', 'data', 'keywordCoverageAudit.json');
  let coverageOk = false;
  const audit = loadJson(auditPath);
  if (audit?.coverage) {
    const cov = audit.coverage;
    const ratio = cov.coverageRatio || 0;
    const weak = cov.weakTerms || 0;
    const zero = cov.zeroEvidenceTerms || 0;
    const complete = cov.complete === true;
    if (complete && ratio >= 1.0 && weak === 0 && zero === 0) {
      coverageOk = true;
    } else {
      issues.push(`coverage: ratio=${(ratio*100).toFixed(0)}% weak=${weak} zero=${zero}`);
    }
  } else {
    issues.push('coverage: audit unreadable');
  }

  // Active task check
  const tasksDir = path.join(cwd, '.claude', 'tasks');
  let activeTasks = [];
  try {
    for (const fn of fs.readdirSync(tasksDir)) {
      if (!fn.endsWith('.json')) continue;
      const cfg = loadJson(path.join(tasksDir, fn));
      if (cfg && cfg.type && cfg.active !== false) activeTasks.push(cfg);
    }
  } catch { /* no tasks dir */ }

  let doneCount = 0;
  let incompleteCount = 0;
  const incompleteTaskLines = [];
  for (const cfg of activeTasks) {
    const done = isTaskComplete(cfg, cwd);
    if (done) {
      doneCount += 1;
    } else {
      incompleteCount += 1;
      incompleteTaskLines.push(taskStatusLine(cfg, cwd));
      issues.push(`${cfg.name}: incomplete`);
    }
  }
  const allTasksDone = incompleteCount === 0 && activeTasks.length > 0;

  if (coverageOk && allTasksDone) {
    const parts = [`${audit?.coverage?.terms || '?'} terms, ${(audit?.coverage?.coverageRatio*100).toFixed(0)}% coverage`];
    parts.push(`${doneCount} task${doneCount !== 1 ? 's' : ''} done`);
    return { decision: 'approve', reason: 'goal achieved — ' + parts.join(' | ') };
  }

  const reasonParts = [];
  if (issues.length > 0) reasonParts.push(issues.join('; '));
  if (doneCount > 0 && incompleteCount > 0) {
    // Summarize completed tasks compactly — don't list them inline
    reasonParts.push(`${doneCount} task${doneCount !== 1 ? 's' : ''} done, ${incompleteCount} remaining`);
  }
  if (incompleteTaskLines.length > 0) reasonParts.push(incompleteTaskLines.join(' | '));

  return { decision: 'block', reason: reasonParts.join(' | ') };
}

// ══════════════════════════════════════════════════════════════════════════
// CHECK 2: Agent lock cleanup
// (inlined from agent-lock.js cmdCleanup)
// ══════════════════════════════════════════════════════════════════════════

function runLockCleanup(cwd) {
  const LOCK_DIR = path.join(cwd, '.claude', 'agent-locks');
  try {
    // Read agent ID
    const idFile = path.join(LOCK_DIR, '.agent-id');
    const idData = loadJson(idFile);
    const agentId = idData?.agentId || 'unknown';

    // Delete heartbeat
    const hbFile = path.join(LOCK_DIR, '.heartbeat-' + agentId + '.json');
    if (fs.existsSync(hbFile)) {
      try { fs.unlinkSync(hbFile); } catch {}
    }

    // Release locks owned by this agent
    let lockCount = 0;
    if (fs.existsSync(LOCK_DIR)) {
      for (const f of fs.readdirSync(LOCK_DIR)) {
        if (!f.endsWith('.lock')) continue;
        const data = loadJson(path.join(LOCK_DIR, f));
        if (data && data.agent === agentId) {
          try { fs.unlinkSync(path.join(LOCK_DIR, f)); lockCount++; } catch {}
        }
      }
    }

    return {
      ok: true,
      msg: 'heartbeat released, ' + lockCount + ' lock' + (lockCount !== 1 ? 's' : '') + ' released',
    };
  } catch (e) {
    return { ok: false, msg: 'cleanup error (non-fatal): ' + (e.message || 'unknown') };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN — orchestrate everything
// ══════════════════════════════════════════════════════════════════════════

function main() {
  // ALL paths go through safeEmit — never write directly to stdout
  const cwd = process.env.CLAUDE_CODE_PROJECT_DIR || process.cwd();

  // 1. Run goal/coverage check
  let goalResult;
  try {
    goalResult = runGoalCheck(cwd);
  } catch (e) {
    // Goal check crashed — log, then approve (don't block the user)
    try { fs.writeSync(2, 'STOP-HUB goal-check error: ' + (e?.message || e) + '\n'); } catch {}
    goalResult = { decision: 'approve', reason: 'goal check error (non-fatal)', skipRest: false };
  }

  // 2. Always run lock cleanup (regardless of goal check result)
  let lockResult;
  try {
    lockResult = runLockCleanup(cwd);
  } catch (e) {
    try { fs.writeSync(2, 'STOP-HUB lock-cleanup error: ' + (e?.message || e) + '\n'); } catch {}
    lockResult = { ok: false, msg: 'lock cleanup error' };
  }

  // 3. Merge results
  // If goal check wants to block, that takes precedence
  if (goalResult.decision === 'block') {
    // Include lock cleanup info in the block reason
    safeEmit('block', goalResult.reason + ' | locks: ' + lockResult.msg);
  } else if (goalResult.reason && goalResult.reason.startsWith('goal achieved')) {
    // Goal achieved — the lock cleanup is background noise; suppress it.
    // The user's conclusion should be "goal achieved", not a hook run log.
    safeEmit('approve', goalResult.reason);
  } else {
    // Approve (no active goal or other non-goal path) — include lock status
    const parts = [];
    if (goalResult.reason) parts.push(goalResult.reason);
    parts.push('locks: ' + lockResult.msg);
    safeEmit('approve', parts.join(' | '));
  }
}

// ── Go ───────────────────────────────────────────────────────────────────
try {
  main();
} catch (e) {
  // Absolute last line of defense
  try { fs.writeSync(2, 'STOP-HUB outer error: ' + (e?.message || e) + '\n'); } catch {}
  safeEmit('approve', 'hub outer error (non-fatal)');
}
