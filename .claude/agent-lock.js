#!/usr/bin/env node
/**
 * Agent Concurrency Control - Dynamic Solo/Multi Mode
 * Single-file CLI. No dependencies. ESM.
 * Commands: heartbeat, solo?, acquire, release, list, isolate, unisolate, cleanup
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
const LOCK_DIR = '.claude/agent-locks';
const DEFAULT_TTL_MIN = 30;
const CWD = process.cwd();
function lockDir() { const d = join(CWD, LOCK_DIR); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; }
function loadJson(fp) { try { return JSON.parse(readFileSync(fp, 'utf8')); } catch { return null; } }
function saveJson(fp, obj) { writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8'); }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
function lockFileName(file) { return file.replace(/[\/\\:]/g, '--') + '.lock'; }
function nowISO() { return new Date().toISOString(); }
function elapsedMinutes(iso) { return (Date.now() - new Date(iso).getTime()) / 60000; }
let _agentId = null;
function detectAgentType() { if (process.env.CLAUDE_PROJECT_DIR) return 'claude-code'; if (process.env.CODEX_HOME || process.env.CODEX_SESSION_ID) return 'codex'; return 'unknown'; }
function agentId() { if (_agentId) return _agentId; const idFile = join(lockDir(), '.agent-id'); const p = loadJson(idFile); if (p && p.agentId) { _agentId = p.agentId; return _agentId; } const t = detectAgentType(); const h = randomBytes(4).toString('hex'); _agentId = t + '-' + h; saveJson(idFile, { agentId: _agentId, agentType: t, createdAt: nowISO() }); return _agentId; }
function myHeartbeatFile() { return join(lockDir(), '.heartbeat-' + agentId() + '.json'); }
function writeHeartbeat(task) { saveJson(myHeartbeatFile(), { agent: agentId(), agentType: detectAgentType(), pid: process.pid, task, startedAt: nowISO() }); }
function readHeartbeats() { const d = lockDir(); let beats = []; for (const f of readdirSync(d).filter(x => x.startsWith('.heartbeat-') && x.endsWith('.json'))) { const data = loadJson(join(d, f)); if (data && data.agent && data.pid) beats.push(data); } return beats; }
function deleteMyHeartbeat() { const f = myHeartbeatFile(); if (existsSync(f)) unlinkSync(f); }
function gcDeadHeartbeats() { const d = lockDir(); for (const f of readdirSync(d).filter(x => x.startsWith('.heartbeat-') && x.endsWith('.json'))) { const data = loadJson(join(d, f)); if (data && data.pid && !pidAlive(data.pid)) unlinkSync(join(d, f)); } }
function liveOthers() { gcDeadHeartbeats(); const self = agentId(); return readHeartbeats().filter(b => b.agent !== self && pidAlive(b.pid)); }
function isSolo() { return liveOthers().length === 0; }
function lockPath(file) { return join(lockDir(), lockFileName(file)); }
function readLock(file) { return loadJson(lockPath(file)); }
function writeLock(file, task, ttl) { saveJson(lockPath(file), { agent: agentId(), pid: process.pid, task, file, ttl, startedAt: nowISO() }); }
function deleteLock(file) { const p = lockPath(file); if (existsSync(p)) unlinkSync(p); }
function isStaleLock(lock) { return !pidAlive(lock.pid) && elapsedMinutes(lock.startedAt) > (lock.ttl || DEFAULT_TTL_MIN); }
function isPidDeadLock(lock) { return !pidAlive(lock.pid); }
function allLocks() { const d = lockDir(); let locks = []; for (const f of readdirSync(d).filter(x => x.endsWith('.lock'))) { const data = loadJson(join(d, f)); if (data && data.agent) locks.push(data); } return locks; }
function releaseMyLocks() { const d = lockDir(); const self = agentId(); let count = 0; for (const f of readdirSync(d).filter(x => x.endsWith('.lock'))) { const data = loadJson(join(d, f)); if (data && data.agent === self) { unlinkSync(join(d, f)); count++; } } return count; }
function myWorktreeName() { return 'agent-' + agentId(); }
function gitMainRepo() { try { const top = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); const gitDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(); if (gitDir !== join(top, '.git')) return resolve(gitDir, '..'); return top; } catch { return null; } }
function inAgentWorktree() { try { const gitDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(); const top = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); return gitDir !== join(top, '.git'); } catch { return false; } }
function printUsage() { console.log('Usage: node .claude/agent-lock.js <command>'); console.log('  heartbeat "<task>"        Write heartbeat, check for others'); console.log('  solo?                     Exit 0=yes, 1=no'); console.log('  acquire [--ttl N] <file> "<task>"  Lock a file'); console.log('  release <file>            Release a lock'); console.log('  list                      Show heartbeats + locks'); console.log('  isolate "<task>"          Create isolated git worktree'); console.log('  unisolate                 Remove current worktree'); console.log('  cleanup                   Delete heartbeat + locks'); }

function cmdHeartbeat(args) {
  const task = args[0] || 'unspecified task';
  writeHeartbeat(task);
  const others = liveOthers();
  if (others.length === 0) { console.log('SOLO'); }
  else { const desc = others.map(o => o.agent + ' - ' + o.task).join(', '); console.log('MULTI (' + others.length + ' other' + (others.length > 1 ? 's' : '') + ': ' + desc + ')'); }
}

function cmdSolo() {
  if (isSolo()) { console.log('yes'); process.exitCode = 0; }
  else { console.log('no'); process.exitCode = 1; }
}

function cmdAcquire(args) {
  let ttl = DEFAULT_TTL_MIN; let fi = 0;
  if (args[0] === '--ttl') { ttl = parseInt(args[1], 10); if (isNaN(ttl) || ttl < 1) { console.error('Invalid TTL'); process.exitCode = 2; return; } fi = 2; }
  const file = args[fi]; const task = args[fi + 1] || 'unspecified task';
  if (!file) { console.error('Usage: node .claude/agent-lock.js acquire [--ttl N] <file> "<task>"'); process.exitCode = 2; return; }
  // Solo mode: clean up stale locks but no active locking needed
  if (isSolo()) {
    const ex = readLock(file);
    if (ex && ex.agent !== agentId() && isPidDeadLock(ex)) { console.log('SOLO - broke orphan lock on ' + file + ' (agent ' + ex.agent + ' process dead)'); deleteLock(file); }
    else if (ex && ex.agent === agentId()) { console.log('SOLO (already yours)'); }
    else { console.log('SOLO (no lock needed)'); }
    process.exitCode = 0; return;
  }
  // Multi mode: full lock protocol
  const existing = readLock(file);
  if (existing) {
    if (existing.agent === agentId()) { writeLock(file, task, ttl); console.log('LOCKED ' + file + ' (TTL: ' + ttl + 'm) [re-entrant]'); process.exitCode = 0; return; }
    // PID dead is the strongest signal — auto-break regardless of TTL
    if (isPidDeadLock(existing)) {
      const age = Math.round(elapsedMinutes(existing.startedAt));
      const ttlMsg = age > (existing.ttl || DEFAULT_TTL_MIN) ? ', TTL expired (' + age + 'min old)' : ' (TTL not expired but process dead)';
      console.log('BROKE stale lock on ' + file + ' (agent ' + existing.agent + ' process dead' + ttlMsg + ')');
      writeLock(file, task, ttl); console.log('LOCKED ' + file + ' (TTL: ' + ttl + 'm)'); process.exitCode = 0; return;
    }
    // PID alive but TTL expired — warn, don't auto-break (agent may be long-running)
    if (elapsedMinutes(existing.startedAt) > (existing.ttl || DEFAULT_TTL_MIN)) {
      const age = Math.round(elapsedMinutes(existing.startedAt));
      console.log('CONFLICT ' + file + ' locked by ' + existing.agent + ' since ' + existing.startedAt + ' (PID ' + existing.pid + ' alive, TTL expired ' + age + 'min ago)');
      console.log('Task: ' + existing.task);
      console.log('Agent is still running but lock TTL has passed. Review manually or wait.');
      process.exitCode = 1; return;
    }
    console.log('CONFLICT ' + file + ' locked by ' + existing.agent + ' since ' + existing.startedAt + ' (PID ' + existing.pid + ' alive)'); console.log('Task: ' + existing.task); console.log('Use --isolate to work in parallel.'); process.exitCode = 1; return;
  }
  writeLock(file, task, ttl); console.log('LOCKED ' + file + ' (TTL: ' + ttl + 'm)'); process.exitCode = 0;
}

function cmdRelease(args) {
  const file = args[0];
  if (!file) { console.error('Usage: node .claude/agent-lock.js release <file>'); process.exitCode = 2; return; }
  const existing = readLock(file);
  if (!existing) { console.log('FREE ' + file + ' (was not locked)'); process.exitCode = 0; return; }
  if (existing.agent !== agentId()) { console.log('NOT YOURS ' + file + ' locked by ' + existing.agent); process.exitCode = 1; return; }
  deleteLock(file); console.log('RELEASED ' + file); process.exitCode = 0;
}

function cmdList() {
  gcDeadHeartbeats(); const beats = readHeartbeats(); const locks = allLocks();
  console.log('HEARTBEATS:'); if (beats.length === 0) console.log('  (none)'); else for (const b of beats) { const a = pidAlive(b.pid) ? 'alive' : 'DEAD'; console.log('  ' + b.agent + '  PID ' + b.pid + '  ' + b.task + '  ' + b.startedAt + '  ' + a); }
  console.log('LOCKS:'); if (locks.length === 0) console.log('  (none)'); else for (const l of locks) { const a = pidAlive(l.pid) ? 'alive' : 'DEAD'; const age = Math.round(elapsedMinutes(l.startedAt)); console.log('  ' + l.file + '  ' + l.agent + '  ' + l.task + '  TTL ' + (l.ttl || DEFAULT_TTL_MIN) + 'm  ' + age + 'm ago  ' + a); }
}

function cmdIsolate(args) {
  const task = args[0] || 'unspecified task'; const mainRepo = gitMainRepo();
  if (!mainRepo) { console.error('ERROR: Not in a git repository.'); process.exitCode = 2; return; }
  const wtName = myWorktreeName(); const wtPath = join(mainRepo, '.claude', 'worktrees', wtName);
  if (existsSync(wtPath)) { console.log('WORKTREE ' + wtPath + ' (already exists)'); console.log('Run: cd ' + wtPath); process.exitCode = 0; return; }
  try { execSync('git worktree add "' + wtPath + '" main', { encoding: 'utf8', cwd: mainRepo, stdio: 'pipe' }); console.log('WORKTREE ' + wtPath); console.log('Run: cd ' + wtPath); process.exitCode = 0; } catch (e) { try { const cb = execSync('git branch --show-current', { encoding: 'utf8', cwd: mainRepo }).trim(); execSync('git worktree add "' + wtPath + '" ' + cb, { encoding: 'utf8', cwd: mainRepo, stdio: 'pipe' }); console.log('WORKTREE ' + wtPath + ' (on ' + cb + ')'); console.log('Run: cd ' + wtPath); process.exitCode = 0; } catch (e2) { console.error('ERROR: Failed to create worktree: ' + (e2.stderr || e2.message)); process.exitCode = 1; } }
}

function cmdUnisolate() {
  if (!inAgentWorktree()) { console.log('NOT ISOLATED (not in a worktree)'); process.exitCode = 0; return; }
  const mainRepo = gitMainRepo(); if (!mainRepo) { console.error('ERROR: Cannot determine main repository.'); process.exitCode = 1; return; }
  const top = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  process.chdir(mainRepo);
  try { execSync('git worktree remove "' + top + '" --force', { encoding: 'utf8', cwd: mainRepo, stdio: 'pipe' }); console.log('UNISOLATED Removed worktree ' + top + ', back to ' + mainRepo); process.exitCode = 0; } catch (e) { console.error('ERROR: Failed to remove worktree: ' + (e.stderr || e.message)); process.exitCode = 1; }
}

function cmdCleanup() {
  try {
    deleteMyHeartbeat(); const lc = releaseMyLocks();
    const msg = 'heartbeat released, ' + lc + ' lock' + (lc !== 1 ? 's' : '') + ' released';
    // Output valid hook JSON to stdout (Claude Code Stop hook contract)
    console.log(JSON.stringify({ decision: 'approve', reason: msg }));
    process.exitCode = 0;
  } catch (e) {
    // Error must NOT go to stdout — Claude Code would fail JSON parse
    console.error('CLEANUP ERROR: ' + e.message);
    console.log(JSON.stringify({ decision: 'approve', reason: 'cleanup error (non-fatal): ' + e.message }));
    process.exitCode = 0;
  }
}

// Main dispatch
const command = process.argv[2]; const args = process.argv.slice(3);

// Detect if we're being invoked as a Claude Code hook (stdin has hook event JSON).
// When auto-discovered as a stop hook, no 'cleanup' arg is passed — we must still
// produce valid {decision, reason} JSON, not usage text.
function _isHookInvocation() {
  // Only check stdin if it's a pipe (not a TTY). On a TTY, readFileSync would block.
  if (process.stdin.isTTY) return false;
  try {
    const buf = readFileSync(0, 'utf8');
    if (buf && buf.trim()) {
      const data = JSON.parse(buf);
      return data && (data.hook_event_name || data.event);
    }
  } catch {}
  return false;
}

if (!command && _isHookInvocation()) {
  // Auto-discovered as a stop hook — run cleanup with valid JSON output
  cmdCleanup();
} else switch (command) {
  case 'heartbeat': cmdHeartbeat(args); break;
  case 'solo?': cmdSolo(); break;
  case 'acquire': cmdAcquire(args); break;
  case 'release': cmdRelease(args); break;
  case 'list': cmdList(); break;
  case 'isolate': cmdIsolate(args); break;
  case 'unisolate': cmdUnisolate(); break;
  case 'cleanup': cmdCleanup(); break;
  default: printUsage(); process.exitCode = command ? 2 : 0;
}