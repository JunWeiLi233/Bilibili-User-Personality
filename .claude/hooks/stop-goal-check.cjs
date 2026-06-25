#!/usr/bin/env node
// Stop hook: deterministic coverage-goal checker.
// Only activates when a GOAL_MODE env-var or session goal marker exists.
// Reads keywordCoverageAudit.json and checks targetEvidence=3 criteria.
// Returns clean JSON — no LLM hallucination risk.

const fs = require('node:fs');
const path = require('node:path');

function emit(result) {
  // Claude Code reads stdout for hook decisions
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.decision === 'block' ? 2 : 0);
}

function main() {
  const cwd = process.env.CLAUDE_CODE_PROJECT_DIR || process.cwd();

  // Read hook input from stdin
  let event = {};
  try {
    const buf = fs.readFileSync(0, 'utf8');
    event = JSON.parse(buf || '{}');
  } catch {
    // no stdin → running standalone, nothing to do
    emit({ decision: 'allow', reason: 'no_event', goal_active: false });
    return;
  }

  // Only handle Stop events
  if (!event.event || (event.event !== 'stop' && event.hook_event_name !== 'Stop')) {
    emit({ decision: 'allow', reason: 'not_stop_event', goal_active: false });
    return;
  }

  // Check if a /goal is active: look for goal condition in the stop hook data
  const hasActiveGoal = !!(event.stop_hook_active || event.stopHookActive);

  if (!hasActiveGoal) {
    // No active goal — this hook is just an informational supplement
    emit({ decision: 'allow', reason: 'no_active_goal', goal_active: false });
    return;
  }

  // Active goal detected — evaluate the coverage condition deterministically
  const auditPath = path.join(cwd, 'server', 'data', 'keywordCoverageAudit.json');

  let audit;
  try {
    audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  } catch (e) {
    emit({
      decision: 'block',
      reason: `Cannot read coverage audit at ${auditPath}: ${e.message}. Run npm run dictionary:coverage first.`,
      stopReason: 'coverage_audit_missing',
      goal_met: false,
    });
    return;
  }

  const coverage = audit.coverage;
  if (!coverage) {
    emit({
      decision: 'block',
      reason: 'Coverage audit is missing "coverage" key.',
      stopReason: 'coverage_audit_invalid',
      goal_met: false,
    });
    return;
  }

  const targetEvidence = audit.targetEvidence || 3;
  const ratio = coverage.coverageRatio || 0;
  const weak = coverage.weakTerms || 0;
  const zero = coverage.zeroEvidenceTerms || 0;
  const complete = coverage.complete === true;
  const terms = coverage.terms || 0;
  const totalEvidence = coverage.totalEvidence || 0;

  if (complete && ratio >= 1.0 && weak === 0 && zero === 0) {
    emit({
      decision: 'allow',
      reason: [
        'Goal complete:',
        `${terms} terms at targetEvidence=${targetEvidence},`,
        `${totalEvidence} total evidence,`,
        `ratio=${(ratio * 100).toFixed(1)}%,`,
        `weak=${weak}, zero=${zero}`,
      ].join(' '),
      stopReason: 'goal_complete',
      goal_met: true,
    });
    return;
  }

  emit({
    decision: 'block',
    reason: [
      'Goal not yet met:',
      `targetEvidence=${targetEvidence},`,
      `ratio=${(ratio * 100).toFixed(1)}%,`,
      `complete=${complete},`,
      `weak=${weak}, zero=${zero}.`,
      'Continue the harvest loop or fix coverage gaps.',
    ].join(' '),
    stopReason: 'goal_not_met',
    goal_met: false,
  });
}

main();
