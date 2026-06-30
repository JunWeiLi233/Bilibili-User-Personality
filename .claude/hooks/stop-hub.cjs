// Stop hook: blocks session exit while active corpus-mining tasks are running.
// Called by Claude Code on session stop/exit.
//
// If any task in .claude/tasks/ has "active": true, this hook prints a
// warning and returns a non-zero exit code to block the shutdown.

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const TASKS_DIR = path.join(PROJECT_DIR, '.claude', 'tasks');

function getActiveTasks() {
  try {
    if (!fs.existsSync(TASKS_DIR)) return [];
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.json'));
    const active = [];
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), 'utf-8'));
        if (content.active === true) {
          active.push({ file, name: content.name || file });
        }
      } catch {
        // skip unparseable files
      }
    }
    return active;
  } catch {
    return [];
  }
}

function main() {
  const active = getActiveTasks();
  if (active.length > 0) {
    console.error('------------------------------------------------------------');
    console.error('STOP BLOCKED: Active corpus-mining tasks are still running:');
    for (const t of active) {
      console.error(`  - ${t.name} (${t.file})`);
    }
    console.error('Mark them as "active": false or delete them before exiting.');
    console.error('------------------------------------------------------------');
    process.exit(1);
  }
  // No active tasks -- allow exit.
  process.exit(0);
}

main();
