#!/usr/bin/env node
// Stop hook: deterministic coverage-goal checker.
// Replaces /goal's LLM-based JSON evaluator with direct file reads.
// Validated against Claude Code hook output schema.

const fs = require('node:fs');
const path = require('node:path');

function emit(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
  // Exit 0 = hook ran successfully (decision carried), 2 = error
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
    emit({
      decision: 'approve',
      reason: 'no_event',
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '' },
    });
    return;
  }

  // Only handle Stop events
  if (event.hook_event_name !== 'Stop' && event.event !== 'stop') {
    emit({
      decision: 'approve',
      reason: 'not_stop_event',
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '' },
    });
    return;
  }

  // Check if a /goal session is active
  const hasActiveGoal = !!(event.stop_hook_active || event.stopHookActive);

  if (!hasActiveGoal) {
    emit({
      decision: 'approve',
      reason: 'no_active_goal',
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '' },
    });
    return;
  }

  // Active goal — evaluate coverage deterministically
  const auditPath = path.join(cwd, 'server', 'data', 'keywordCoverageAudit.json');

  let audit;
  try {
    audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  } catch (e) {
    emit({
      decision: 'block',
      reason: `Coverage audit not found at ${auditPath}: ${e.message}. Run npm run dictionary:coverage first.`,
      stopReason: 'coverage_audit_missing',
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `Coverage audit file is missing. Run: npm run dictionary:coverage`,
      },
    });
    return;
  }

  const coverage = audit.coverage;
  if (!coverage) {
    emit({
      decision: 'block',
      reason: 'Coverage audit has no "coverage" key.',
      stopReason: 'coverage_audit_invalid',
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'Coverage audit JSON is malformed. Regenerate with: npm run dictionary:coverage',
      },
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
  const avgEvidence = coverage.averageEvidence || 0;

  if (complete && ratio >= 1.0 && weak === 0 && zero === 0) {
    const msg = `Goal complete: ${terms} terms at targetEvidence=${targetEvidence}, ${totalEvidence} total evidence (avg ${avgEvidence}/term), ratio=${(ratio * 100).toFixed(1)}%, weak=${weak}, zero=${zero}.`;
    emit({
      decision: 'approve',
      reason: msg,
      stopReason: 'goal_complete',
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: msg,
      },
    });
    return;
  }

  // Goal not met — block stop
  const msg = [
    `Goal not yet met: targetEvidence=${targetEvidence},`,
    `ratio=${(ratio * 100).toFixed(1)}%,`,
    `complete=${complete},`,
    `weak=${weak}, zero=${zero},`,
    `terms=${terms}, totalEvidence=${totalEvidence}.`,
    'Continue the harvest loop or fix coverage gaps.',
  ].join(' ');

  emit({
    decision: 'block',
    reason: msg,
    stopReason: 'goal_not_met',
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: msg,
    },
  });
}

main();
