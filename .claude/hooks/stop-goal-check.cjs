#!/usr/bin/env node
/**
 * Stop hook: checks keyword coverage audit + all active task progress files.
 * Blocks exit until coverage is complete AND all active tasks are done.
 *
 * Scans .claude/tasks/*.json for active tasks, reads each task's progress
 * file, determines if the task is complete. A task is "complete" when:
 *   - bilibili-seed-scrape: all rounds marked done + harvest done (or no harvest)
 *   - bilibili-keyword-search: keyword_search_done flag set
 *   - bilibili-danmaku-deep: danmaku_deep_done flag set
 *   - tieba-keyword-scrape: progress shows all items done
 *   - Custom: any progress with "done": true at top level
 */

const fs = require('node:fs');
const path = require('node:path');

function emit(result) {
  const out = { decision: result.decision, reason: result.reason || '' };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(out.decision === 'block' ? 2 : 0);
}

function loadJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function isTaskComplete(cfg, cwd) {
  const progressFile = cfg.progressFile;
  if (!progressFile) return true; // no progress tracking = assume complete

  const pp = path.join(cwd, progressFile);
  const progress = loadJson(pp);
  if (!progress) return false; // no progress file = not started

  // Generic "done" flag
  if (progress.done === true) return true;

  // bilibili-seed-scrape: all rounds done + harvest done
  if (cfg.type === 'bilibili-seed-scrape') {
    const rounds = cfg.rounds || [];
    const scrapeRounds = rounds.filter(r => r.type !== 'harvest');
    const harvestRound = rounds.find(r => r.type === 'harvest');

    const allScrapeDone = scrapeRounds.every(r => progress[`round_${r.id}_done`] === true);
    const harvestDone = !harvestRound || progress.harvest_done === true;
    return allScrapeDone && harvestDone;
  }

  // bilibili-keyword-search: keyword_search_done flag
  if (cfg.type === 'bilibili-keyword-search') {
    return progress.keyword_search_done === true;
  }

  // bilibili-danmaku-deep: danmaku_deep_done flag
  if (cfg.type === 'bilibili-danmaku-deep') {
    return progress.danmaku_deep_done === true;
  }

  // tieba-keyword-scrape: items-based
  if (cfg.type === 'tieba-keyword-scrape') {
    const total = cfg.totalItems || 0;
    const done = (progress.completed || []).length + (progress.blocked || []).length;
    return total > 0 && done >= total;
  }

  // Fallback: check if completed + blocked >= totalItems
  const total = cfg.totalItems || 0;
  if (total > 0) {
    const done = (progress.completed || []).length + (progress.blocked || []).length;
    return done >= total;
  }

  return false; // can't determine = assume incomplete
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
    const blocked = (progress.blocked || []).length;
    const total = cfg.totalItems || '?';
    // Round status indicators (seed-scrape tasks only)
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

function main() {
  const cwd = process.env.CLAUDE_CODE_PROJECT_DIR || process.cwd();

  // Read hook input
  let event = {};
  try {
    const buf = fs.readFileSync(0, 'utf8');
    if (buf && buf.trim()) event = JSON.parse(buf);
  } catch { /* empty stdin */ }

  const isStop = event.hook_event_name === 'Stop' || event.event === 'stop';
  const hasGoal = !!(event.stop_hook_active || event.stopHookActive);

  if (!isStop || !hasGoal) {
    emit({ decision: 'approve', reason: 'no active goal' });
    return;
  }

  const issues = [];

  // --- Check 1: Keyword coverage audit ---
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

  // --- Check 2: Active task configs ---
  const tasksDir = path.join(cwd, '.claude', 'tasks');
  let activeTasks = [];
  try {
    for (const fn of fs.readdirSync(tasksDir)) {
      if (!fn.endsWith('.json')) continue;
      const cfg = loadJson(path.join(tasksDir, fn));
      if (cfg && cfg.type && cfg.active !== false) activeTasks.push(cfg);
    }
  } catch { /* no tasks dir */ }

  const taskLines = [];
  let allTasksDone = true;
  for (const cfg of activeTasks) {
    const done = isTaskComplete(cfg, cwd);
    taskLines.push(taskStatusLine(cfg, cwd));
    if (!done) {
      allTasksDone = false;
      issues.push(`${cfg.name}: incomplete`);
    }
  }

  // --- Decision ---
  if (coverageOk && allTasksDone) {
    const parts = [`${audit?.coverage?.terms || '?'} terms, ${(audit?.coverage?.coverageRatio*100).toFixed(0)}% coverage`];
    if (taskLines.length > 0) parts.push(`${taskLines.length} tasks done`);
    emit({ decision: 'approve', reason: parts.join(' | ') });
    return;
  }

  const reasonParts = [];
  if (issues.length > 0) reasonParts.push(issues.join('; '));
  if (taskLines.length > 0) reasonParts.push(taskLines.join(' | '));

  emit({ decision: 'block', reason: reasonParts.join(' | ') });
}

main();
