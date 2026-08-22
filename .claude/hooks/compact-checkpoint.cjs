// UserPromptSubmit hook (triggered by "/compact*" commands).
// Writes a machine- and human-readable state checkpoint before compaction
// so the next session can recover context.
//
// CLAUDE.md says to check .claude/.compact_state.md first on any resumed turn.

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const STATE_FILE = path.join(PROJECT_DIR, '.claude', '.compact_state.md');
const STATE_JSON = path.join(PROJECT_DIR, '.claude', '.compact_state.json');

function getGitInfo() {
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    const status = execSync('git status --short', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    return { branch, commit, status };
  } catch {
    return { branch: 'unknown', commit: 'unknown', status: '' };
  }
}

function getActiveTasks() {
  const tasksDir = path.join(PROJECT_DIR, '.claude', 'tasks');
  try {
    if (!fs.existsSync(tasksDir)) return [];
    return fs.readdirSync(tasksDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(tasksDir, f), 'utf-8'));
          return { file: f, name: content.name || f, active: content.active };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function main() {
  const git = getGitInfo();
  const tasks = getActiveTasks();

  const stateMd = `# Compact State Checkpoint
Generated: ${formatTimestamp()}

## Git
- **Branch:** ${git.branch}
- **Commit:** ${git.commit}
- **Dirty:** ${git.status ? 'yes' : 'no'}

## Active Tasks
${tasks.length === 0 ? 'None' : tasks.map(t => `- **${t.name}** (${t.file}) — active: ${t.active}`).join('\n')}

## Recovery Instructions
On resume, read this file first, then check:
- \`.claude/MASTER_PLAN.md\` for overall plan and current phase
- \`.claude/tasks/*.json\` for active task state
- \`.claude/personality_analysis_report_*.md\` for last analysis results
`;

  const stateJson = JSON.stringify({
    generatedAt: formatTimestamp(),
    git,
    tasks,
  }, null, 2);

  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, stateMd, 'utf-8');
    fs.writeFileSync(STATE_JSON, stateJson, 'utf-8');
  } catch (err) {
    console.error(`compact-checkpoint: could not write state files: ${err.message}`);
  }
}

main();
