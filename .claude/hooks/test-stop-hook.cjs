#!/usr/bin/env node
/**
 * Test harness for stop-goal-check.cjs
 * Tests 4 scenarios:
 *   1. No sentinel file → approve (exit 0)
 *   2. Sentinel + coverage OK + tasks done → approve (exit 0)
 *   3. Sentinel + incomplete tasks → block (exit 2)
 *   4. Sentinel + incomplete coverage → block (exit 2)
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'stop-goal-check.cjs');
const TMP = path.join(__dirname, '..', '.autor_test_tmp');

let passed = 0;
let failed = 0;

function setup(files) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(TMP, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (typeof content === 'object') {
      fs.writeFileSync(full, JSON.stringify(content, null, 2));
    } else {
      fs.writeFileSync(full, content);
    }
  }
}

function runHook(event) {
  const result = spawnSync('node', [HOOK], {
    cwd: TMP,
    input: JSON.stringify(event),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_CODE_PROJECT_DIR: TMP },
  });
  let parsed = null;
  try { parsed = JSON.parse((result.stdout || '').trim()); } catch {}
  return {
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    decision: parsed?.decision || null,
    reason: parsed?.reason || '',
  };
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL: ${name} — ${e.message}`);
  }
}

// --- Scenario 1: No sentinel → approve ---
test('no sentinel → approve immediately', () => {
  setup({});
  // Create empty tasks dir (hook handles missing gracefully)
  fs.mkdirSync(path.join(TMP, '.claude', 'tasks'), { recursive: true });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 2: Sentinel + coverage OK + tasks done → approve ---
test('sentinel + coverage OK + tasks done → approve', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
    '.claude/tasks/test-task.json': {
      name: 'test-task',
      type: 'bilibili-seed-scrape',
      active: true,
      totalItems: 10,
      progressFile: '.claude/tasks/test_progress.json',
      rounds: [{ id: 1, label: 'R1' }],
    },
    '.claude/tasks/test_progress.json': {
      done: true,
    },
  });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 3: Sentinel + incomplete tasks → block ---
test('sentinel + incomplete tasks → block', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
    '.claude/tasks/test-task.json': {
      name: 'incomplete-task',
      type: 'bilibili-seed-scrape',
      active: true,
      totalItems: 10,
      progressFile: '.claude/tasks/test_progress.json',
      rounds: [{ id: 1, label: 'R1' }],
    },
    '.claude/tasks/test_progress.json': {
      completed: ['seed1', 'seed2'],
      blocked: [],
    },
  });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'block') throw new Error(`expected block, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 4: Sentinel + incomplete coverage → block ---
test('sentinel + incomplete coverage → block', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: false,
        coverageRatio: 0.85,
        weakTerms: 12,
        zeroEvidenceTerms: 5,
        terms: 100,
      },
    },
    '.claude/tasks/test-task.json': {
      name: 'done-task',
      type: 'bilibili-seed-scrape',
      active: true,
      totalItems: 10,
      progressFile: '.claude/tasks/test_progress.json',
      rounds: [{ id: 1, label: 'R1' }],
    },
    '.claude/tasks/test_progress.json': {
      done: true,
    },
  });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'block') throw new Error(`expected block, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 5: No sentinel + stop_hook_active flag → still approve (flag ignored) ---
test('no sentinel + stop_hook_active flag → still approve (event flag ignored)', () => {
  setup({});
  fs.mkdirSync(path.join(TMP, '.claude', 'tasks'), { recursive: true });
  const r = runHook({ hook_event_name: 'Stop', stop_hook_active: true });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 6: Sentinel + no tasks dir → approve if coverage OK ---
test('sentinel + no tasks dir + coverage OK → approve', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
  });
  // No .claude/tasks/ directory at all
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 7: Sentinel + all tasks inactive → approve if coverage OK ---
test('sentinel + all tasks inactive → approve if coverage OK', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
    '.claude/tasks/task-inactive.json': {
      name: 'inactive-task',
      type: 'bilibili-seed-scrape',
      active: false,
      totalItems: 10,
      progressFile: '.claude/tasks/test_progress.json',
      rounds: [{ id: 1, label: 'R1' }],
    },
    '.claude/tasks/test_progress.json': {
      completed: ['seed1'],
      blocked: [],
    },
  });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 8: Non-Stop event + sentinel → approve (not a stop event) ---
test('non-Stop event + sentinel → approve (not a stop event)', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
  });
  fs.mkdirSync(path.join(TMP, '.claude', 'tasks'), { recursive: true });
  const r = runHook({ hook_event_name: 'PreToolUse' });
  if (r.decision !== 'approve') throw new Error(`expected approve, got ${r.decision}: ${r.reason}`);
});

// --- Scenario 9: Sentinel + mixed active/inactive tasks → only checks active ---
test('sentinel + mixed active/inactive → block on incomplete active task', () => {
  setup({
    '.claude/.goal_active': '',
    'server/data/keywordCoverageAudit.json': {
      coverage: {
        complete: true,
        coverageRatio: 1.0,
        weakTerms: 0,
        zeroEvidenceTerms: 0,
        terms: 100,
      },
    },
    '.claude/tasks/done-active.json': {
      name: 'done-active',
      type: 'bilibili-seed-scrape',
      active: true,
      totalItems: 10,
      progressFile: '.claude/tasks/done_progress.json',
      rounds: [{ id: 1, label: 'R1' }],
    },
    '.claude/tasks/done_progress.json': { done: true },
    '.claude/tasks/incomplete-active.json': {
      name: 'incomplete-active',
      type: 'bilibili-keyword-search',
      active: true,
      totalItems: 100,
      progressFile: '.claude/tasks/incomplete_progress.json',
    },
    '.claude/tasks/incomplete_progress.json': {
      keyword_search_done: false,
      completed: ['term1'],
    },
    '.claude/tasks/inactive.json': {
      name: 'inactive',
      type: 'bilibili-danmaku-deep',
      active: false,
      totalItems: 500,
      progressFile: '.claude/tasks/inactive_progress.json',
    },
    '.claude/tasks/inactive_progress.json': {
      completed: [],
      blocked: [],
    },
  });
  const r = runHook({ hook_event_name: 'Stop' });
  if (r.decision !== 'block') throw new Error(`expected block on incomplete active task, got ${r.decision}: ${r.reason}`);
});

// --- Summary ---
const total = passed + failed;
const score = total > 0 ? (passed / total).toFixed(2) : '0.00';
console.log(`\nScore: ${score}`);
console.log(`Passed: ${passed}/${total}`);

// Cleanup
fs.rmSync(TMP, { recursive: true, force: true });

process.exit(failed > 0 ? 1 : 0);
