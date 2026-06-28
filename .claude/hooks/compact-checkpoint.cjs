#!/usr/bin/env node
/**
 * UserPromptSubmit hook: saves compact-recovery state before /compact runs.
 *
 * When the user submits "/compact", this hook writes key session facts to
 * .claude/.compact_state.md so the model can recover even if compaction
 * produces an empty or unusable summary.
 *
 * This is a fire-and-forget safety net. It never blocks the user.
 */

const fs = require('node:fs');
const path = require('node:path');

function loadJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function main() {
  const cwd = process.env.CLAUDE_CODE_PROJECT_DIR || process.cwd();

  // Read hook input
  let event = {};
  try {
    const buf = fs.readFileSync(0, 'utf8');
    if (buf && buf.trim()) event = JSON.parse(buf);
  } catch { /* not a hook invocation */ }

  // Only act on UserPromptSubmit
  if (event.hook_event_name !== 'UserPromptSubmit') {
    // Always output valid JSON for hook compatibility
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }

  const prompt = event.prompt || '';
  const isCompact = /^\/compact(\s|$)/.test(prompt.trim());

  // Always let the prompt through
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');

  if (!isCompact) return;

  // ── Pre-compaction state dump ──────────────────────────────────────
  const outPath = path.join(cwd, '.claude', '.compact_state.md');

  const lines = [];
  lines.push('# Pre-compaction session state');
  lines.push('');
  lines.push('> Saved automatically before `/compact` on ' + new Date().toISOString());
  lines.push('');

  // Branch
  try {
    const { execSync } = require('node:child_process');
    const branch = execSync('git branch --show-current', { encoding: 'utf8', cwd }).trim();
    lines.push('- **Branch:** `' + branch + '`');
  } catch { lines.push('- **Branch:** unknown'); }

  // Goal
  const goalFile = path.join(cwd, '.claude', '.goal_active');
  if (fs.existsSync(goalFile)) {
    lines.push('- **Goal:** ACTIVE (`.claude/.goal_active` exists)');
  }

  // Active tasks
  const tasksDir = path.join(cwd, '.claude', 'tasks');
  try {
    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
    if (taskFiles.length > 0) {
      lines.push('- **Active tasks:**');
      for (const fn of taskFiles) {
        const cfg = loadJson(path.join(tasksDir, fn));
        if (cfg && cfg.name) {
          const status = cfg.active === false ? ' (paused)' : '';
          lines.push('  - `' + fn + '` — ' + cfg.name + status);
        }
      }
    }
  } catch { /* no tasks dir */ }

  // MASTER_PLAN
  const planFile = path.join(cwd, '.claude', 'MASTER_PLAN.md');
  if (fs.existsSync(planFile)) {
    lines.push('- **MASTER_PLAN.md:** available at `.claude/MASTER_PLAN.md`');
  }

  // Key data files
  const keyFiles = [
    ['keywordCoverageAudit.json', 'server/data/keywordCoverageAudit.json'],
    ['tiebaKeywordCorpus.json', 'server/data/tiebaKeywordCorpus.json'],
  ];
  for (const [label, fp] of keyFiles) {
    if (fs.existsSync(path.join(cwd, fp))) {
      lines.push('- **' + label + ':** available at `' + fp + '`');
    }
  }

  lines.push('');
  lines.push('## Recovery instructions');
  lines.push('');
  lines.push('If compaction produced an empty response, read the files listed above');
  lines.push('to reconstruct context. Then check `CLAUDE.md` for the current phase.');
  lines.push('');

  try {
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  } catch { /* best effort */ }
}

main();
