#!/usr/bin/env node
// Stop hook: deterministic coverage + scrape-goal checker.
// Outputs minimal JSON to avoid Claude Code schema validation issues.

const fs = require('node:fs');
const path = require('node:path');

function emit(result) {
  const out = { decision: result.decision, reason: result.reason || '' };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(out.decision === 'block' ? 2 : 0);
}

function main() {
  const cwd = process.env.CLAUDE_CODE_PROJECT_DIR || process.cwd();

  // Read hook input from stdin
  let event = {};
  try {
    const buf = fs.readFileSync(0, 'utf8');
    if (buf && buf.trim()) event = JSON.parse(buf);
  } catch { /* empty stdin is ok */ }

  // Only handle Stop events with an active /goal
  const isStop = event.hook_event_name === 'Stop' || event.event === 'stop';
  const hasGoal = !!(event.stop_hook_active || event.stopHookActive);

  if (!isStop || !hasGoal) {
    emit({ decision: 'approve', reason: 'no active goal' });
    return;
  }

  // --- Check 1: Keyword coverage audit ---
  const auditPath = path.join(cwd, 'server', 'data', 'keywordCoverageAudit.json');
  let coverageOk = false;
  try {
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    const cov = audit.coverage;
    if (cov) {
      const targetEvidence = audit.targetEvidence || 3;
      const ratio = cov.coverageRatio || 0;
      const weak = cov.weakTerms || 0;
      const zero = cov.zeroEvidenceTerms || 0;
      const complete = cov.complete === true;
      if (complete && ratio >= 1.0 && weak === 0 && zero === 0) {
        coverageOk = true;
      }
    }
  } catch { /* audit unreadable — will check scrape progress instead */ }

  // --- Check 2: Deep scrape round completion ---
  const planFile = path.join(cwd, '.claude', 'multi_round_deep_scrape_plan.md');
  const planExists = fs.existsSync(planFile);

  if (!planExists) {
    // No scrape plan active — rely on coverage alone
    if (coverageOk) {
      emit({ decision: 'approve', reason: 'coverage complete, no scrape plan active' });
    } else {
      emit({ decision: 'block', reason: 'coverage incomplete, no scrape plan active' });
    }
    return;
  }

  // Check progress of the 4 scrape rounds
  const progressDirs = [
    { round: 1, file: '.claude/scrape_progress_deep.json', label: 'R1: deepen top-5 (pages=5)' },
    { round: 2, file: '.claude/scrape_progress_batch2.json', label: 'R2: videos 6-10 (pages=3)' },
    { round: 3, file: '.claude/scrape_progress_batch3.json', label: 'R3: videos 11-15 (pages=2)' },
  ];

  const TARGET_SEEDS = 196;
  const roundStatus = [];

  for (const rd of progressDirs) {
    const fp = path.join(cwd, rd.file);
    if (!fs.existsSync(fp)) {
      roundStatus.push(`${rd.label}: NOT STARTED`);
      continue;
    }
    try {
      const p = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const completed = (p.completed || []).length;
      const blocked = (p.blocked || []).length;
      const pct = Math.round((completed / TARGET_SEEDS) * 100);
      if (completed + blocked >= TARGET_SEEDS) {
        roundStatus.push(`${rd.label}: DONE (${completed} seeds, ${blocked} blocked)`);
      } else {
        roundStatus.push(`${rd.label}: ${pct}% (${completed}/${TARGET_SEEDS})`);
      }
    } catch {
      roundStatus.push(`${rd.label}: CORRUPT`);
    }
  }

  // Check R4 — evidence harvest
  const harvestReportPath = path.join(cwd, 'server', 'data', 'seedCorpusHarvestReport.json');
  let r4Done = false;
  try {
    const hr = JSON.parse(fs.readFileSync(harvestReportPath, 'utf8'));
    // If the report was updated after the plan file, consider R4 done
    const planStat = fs.statSync(planFile);
    const hrStat = fs.statSync(harvestReportPath);
    if (hrStat.mtimeMs > planStat.mtimeMs) {
      r4Done = true;
      roundStatus.push('R4: harvest DONE');
    } else {
      roundStatus.push('R4: harvest STALE (needs re-run)');
    }
  } catch {
    roundStatus.push('R4: harvest NOT RUN');
  }

  const allRoundsDone = roundStatus.every(s => s.includes('DONE') || s.includes('NOT STARTED') === false);

  // --- Decision ---
  if (coverageOk && allRoundsDone) {
    emit({
      decision: 'approve',
      reason: `All goals met: coverage complete + 4-round scrape done. ${roundStatus.join(' | ')}`,
    });
    return;
  }

  const reasons = [];
  if (!coverageOk) reasons.push('coverage incomplete');
  if (!allRoundsDone) reasons.push('scrape rounds pending');

  emit({
    decision: 'block',
    reason: reasons.join('; ') + '. ' + roundStatus.join(' | '),
  });
}

main();
