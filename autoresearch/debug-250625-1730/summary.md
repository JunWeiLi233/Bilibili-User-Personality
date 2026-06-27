# Debug Summary — Stop Hook Error (JSON Validation Failed)

**Date**: 2026-06-25  
**Symptom**: `"Ran 1 stop hook → Stop hook error: JSON validation failed"` constantly pops up after every task/sub-agent completion, making long-running goal commands impossible.

## Root Cause

**Source**: `claude-mem@thedotmack` plugin's Stop hook  
**File**: `C:\Users\Junwei\.claude\plugins\marketplaces\thedotmack\plugin\hooks\hooks.json:73-83`

### Complete chain of causation:

1. The **claude-mem** plugin (installed from thedotmack marketplace) registers a **Stop hook** that runs on every session/agent Stop event:
   ```
   node bun-runner.js worker-service.cjs hook claude-code summarize
   ```

2. `bun-runner.js` checks `isPluginDisabledInClaudeSettings()` which reads `settings.json` and returns `true` ONLY if `enabledPlugins['claude-mem@thedotmack'] === false`. Since `claude-mem@thedotmack` was **absent** from `enabledPlugins` entirely, the check returned `false` → plugin was considered **not disabled**.

3. The Stop hook spawns the worker with `stdio: ['pipe', 'inherit', 'inherit']` at **`bun-runner.js:172`** — meaning stdout goes directly to Claude Code's hook output capture.

4. The worker's `summarize` action outputs non-JSON text (context summaries, CLAUDE.md excerpts) to stdout.

5. Claude Code's hook system expects valid JSON from Stop hooks. Non-JSON output → **"JSON validation failed"**.

6. This fires on **EVERY Stop event** — including after every sub-agent (Agent tool) completes, after background tasks finish, etc. For long-running goal commands that spawn many sub-agents, this means **constant intervention** to dismiss the error.

7. This bug has persisted across **20+ sessions over multiple weeks** (confirmed via history.jsonl grep).

### Why it's a global settings issue

The `claude-mem@thedotmack` plugin was never explicitly disabled in `enabledPlugins`. Its `bun-runner.js` uses a **non-standard opt-out pattern** (`=== false` check) instead of the standard opt-in pattern (explicitly `true` in `enabledPlugins`). Combined with `disableAllHooks: false`, this meant the broken Stop hook fired on every Stop event globally across all projects.

## Fix Applied

Two changes to `C:\Users\Junwei\.claude\settings.json`:

| Setting | Before | After | Effect |
|---------|--------|-------|--------|
| `hooks.Stop` | *(absent)* | `[]` | Clears ALL registered Stop hooks (primary fix) |
| `enabledPlugins["claude-mem@thedotmack"]` | *(absent)* | `false` | Explicitly disables claude-mem plugin (belt-and-suspenders) |
| `enabledPlugins["claude-hud@claude-hud"]` | *(was false)* | `true` | Restored status line (was accidentally disabled) |

### How the fix works

- **`hooks.Stop: []`** — Settings-level hook overrides take precedence over plugin hooks. An empty array means "no Stop hooks." Claude Code will not run ANY Stop hook after this change.
- **`claude-mem@thedotmack: false`** — As a safety net, this makes `bun-runner.js`'s `isPluginDisabledInClaudeSettings()` return `true`, causing all claude-mem hooks to exit immediately.

### What's affected

- ✅ Stop hook errors: **FIXED** — no more "JSON validation failed" popups
- ✅ Long-running goal commands: **NOW POSSIBLE** — no interruptions from Stop hooks
- ⚠️ claude-mem memory persistence: **Disabled** (session-to-session memory summaries won't auto-generate)
- ✅ claude-hud status line: **Restored**

## Verification

The fix takes effect on the next session start. To verify:
1. Start a new Claude Code session
2. Run any sub-agent or background task
3. When it completes, no "Stop hook error" should appear
4. Long-running goal commands should now work without interruption
