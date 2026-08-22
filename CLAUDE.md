# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Facts

- Purpose: research prototype for analyzing public Bilibili comments, replies, and danmaku for bounded argumentative-behavior risk, not clinical diagnosis. See `README.md`.
- Note: Tieba (贴吧) scraper was fully removed (49 files, 68 skipped tests remaining as historical markers). Do not attempt to use Tieba scraping — it no longer exists.
- Stack: React 19 + Vite frontend in `src/`, Hono Node backend in `server/`, Python migration/backend utilities in `python_backend/`, JSON data contracts in `server/data/`.
- JS runtime: ESM (`"type": "module"` in `package.json`). Tests use Node's built-in `node --test` runner (not Jest/Mocha).
- Architecture direction: hybrid JS + Python. JavaScript keeps app/API orchestration; Python should own data-heavy corpus, coverage, scraping-plan, verification, and analyzer compatibility work once parity is proven.
- Compatibility boundary: JSON payloads and CLI commands between `server/scripts/` and `python_backend/cli/`.
- Detailed architecture and risks live in `docs/PROJECT_MAP.md`.

## Agent Rules — READ AGENTS.md FIRST

`AGENTS.md` (repo root) is the authoritative, agent-agnostic rules file (newer than this one). **Every coding agent must follow it.** Highlights you must not miss:

- **Agent coordination** (§0): AGENTS.md defines a lock protocol (`node .claude/agent-lock.js heartbeat/acquire/release`), but **the script is currently absent from this checkout** — skip the lock steps until it's restored; work in worktrees for parallel runs instead.
- **Syntax** (§1): JS is ESM-only (no `require`, `.js` extensions required in imports); Python CLIs import via full `python_backend.cli.*` paths (no relative imports).
- **Secrets** (§4): never a real API key/cookie as literal, default arg, or fallback — env vars only with `""` or error-out. `set-deepseek-env.ps1` and `set-decodo-env.ps1` are gitignored; `*.example.ps1` templates are safe.
- **Git staging** (§5.1): never stage generated files under `server/data/deepseekKeywordDictionary.*/` or `server/data/keywordCoverage*` unless the task explicitly asks for harvested data output. Commit format `type: short description`; branch `feat/` or `fix/` from `main`.
- **JS/Python parity** (§6): Python CLIs must produce identical JSON to their JS counterparts before the JS path is retired; `server/scripts/compare*.js` verifies.
- **Annotation scale** (§9): 0/1/2 labels, label the text not the person, default to 0, target Cohen's κ ≥ 0.6.
- **Coverage checkpoint system** (§13) and **stats-SVG format rules** (§14): see sections below.

## Environment Setup (Critical First Step)

```powershell
# 1. Copy and edit the DeepSeek env template
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
# Edit set-deepseek-env.ps1 with your real API key

# 2. Dot-source it (not just execute) so vars stay in the current shell
. .\set-deepseek-env.ps1

# 3. Ensure Python dependencies are installed (the project uses standard library + common packages like requests)
```

Required env vars: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `DEEPSEEK_MODEL` (default `deepseek-v4-flash`), `DEEPSEEK_REASONING_EFFORT` (default `max`).

For WBI-mode (cookie-less) harvests you also need Decodo credentials: `set-decodo-env.ps1` (from `set-decodo-env.example.ps1`), which sets `BILIBILI_PROXY_LIST`. See "Scraping & Rate Limiting".

## Server Architecture

`npm run server` (`node --env-file=.env server/index.js`) starts the Hono API on `http://127.0.0.1:8787` and auto-spawns Vite dev server on `http://127.0.0.1:5191` (unless `START_VITE=0`). Vite proxies `/api` requests to the Hono backend.

For standalone frontend dev: `npm run dev` starts Vite only (backend must already be running).

Routes are mounted under `/api/bilibili`, `/api/deepseek`, `/api/aicu`, and `/api/health`.

## Common Commands

```powershell
# Development
npm install
npm run server              # Hono API + Vite dev server
npm run dev                 # Vite only (needs backend running separately)
npm run build               # Vite production build
npm run lint                # ESLint on server/

# Testing
npm test                    # All JS tests (node --test)
node --test server/services/bilibiliCrawler.test.js   # Single JS test file
node --test --test-name-pattern="should handle rate limit" server/services/bilibiliCrawler.test.js
npm run python:test         # All Python tests (68 skipped — Tieba scraper removed)
python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method  # Single Python test

# Dictionary & coverage (coverage audit and stats are Python-backed)
npm run dictionary:coverage          # Python audit → server/data/keywordCoverageAudit.json + queries/actions
npm run dictionary:auto              # Auto-coverage harvest loop (JS, runCoverageHarvestLoop.js)
npm run dictionary:auto-watchdog     # Watchdog: crash/power-loss recovery + relaunch
npm run dictionary:prune             # General dictionary cleanup
npm run dictionary:prune-exhausted   # Prune terms with exhausted discovery
npm run dictionary:resolve-near      # Near-target resolver plan
npm run dictionary:mine-local        # Python text-matching miner over local corpus files
npm run dictionary:huggingface       # Hugging Face corpus import
npm run dictionary:history-tags      # History-tag corpus import
npm run dictionary:probe-bilibili    # Direct Bilibili probe (live-fetch evidence)
npm run dictionary:mine-loop         # Corpus mining loop
npm run dictionary:firecrawl         # Firecrawl harvest
npm run stats:update                 # Python: README stats block + docs/stats/*.svg graphs

# Python migration verification
npm run python:migration-inventory   # Current migration backlog and gates
npm run python:compare               # Compare JS vs Python contract outputs
npm run python:verify-random         # Random verification of evidence

# Coverage checkpoint recovery (power-loss safety, see below)
node server/scripts/restoreCoverageCheckpoint.js --list            # List snapshots
node server/scripts/restoreCoverageCheckpoint.js --restore-latest  # Restore newest snapshot
```

## JS/Python Parity Convention

Migration follows a strict compare-before-replace pattern. Python CLIs must produce identical JSON outputs to their JS counterparts before the JS path is retired. Comparator scripts in `server/scripts/compare*.js` verify parity. Always run the relevant comparator after changing Python migration code.

## Key Entry Points

- Frontend: `src/main.jsx` (SPA entry, UI, scoring, radar wiring), `src/languageUnderstanding.js` (axis normalization, meme/quote handling)
- Backend API: `server/index.js` (Hono bootstrap), `server/routes/bilibili.js`, `server/routes/deepseek.js`, `server/routes/aicu.js`
- JS services: `server/services/` (crawler, keyword harvest, DeepSeek training, semantic matching, coverage checkpoint, Hugging Face, local corpus)
- JS scripts/CLI: `server/scripts/` (discovery, coverage loops, checkpoint restore, merge tools, parity comparators)
- Python CLI: `python_backend/cli/` (coverage, corpus, scraping plans, analyzers, migration)
- Annotation pipeline: `.claude/annotation_data/` (κ labels, stratified candidates, reports), `server/scripts/extractStratifiedCandidates.js`
- Calibration: `python_backend/analysis/calibration.py` (learn_weights_from_labels, logistic regression over labeled data)
- Full directory map: `docs/PROJECT_MAP.md`

## Workflow Rules

- Before modifying code, read the relevant modules and call chain, then state current behavior, impact scope, and a modification plan.
- For behavior changes, use TDD: write/verify a failing test first, implement the smallest fix, then rerun relevant tests.
- Preserve JS behavior during migration. Add or update JS/Python comparison commands before replacing JS runtime paths.
- Do not stage generated files in `server/data/deepseekKeywordDictionary.*/` or `server/data/keywordCoverage*` unless the task explicitly asks for harvested data output.
- Do not commit secrets or real production config. **NEVER put a real API key, token, or cookie in source code** — not as a literal, not as a default argument, not in agent-generated scripts. Use env vars exclusively with `""` or error-out as fallback. `set-deepseek-env.ps1` and `set-decodo-env.ps1` contain credentials and are gitignored; use their `*.example.ps1` templates with placeholder values. If you generate a new script that needs a credential: (a) read it from the environment only, (b) never provide a real value as a default, (c) if the file accidentally contains a secret-like string, add it to `.gitignore` immediately before committing.
- Documentation-only tasks must not modify business code.
- Many Chinese strings in `src/main.jsx` and `src/languageUnderstanding.js` have known encoding issues. Treat Chinese text edits carefully and verify encoding before broad rewrites.

## Scraping & Rate Limiting

The crawler is intentionally conservative: sequential requests, brief caching, capped pages, cooldown on rate limits. Do not add bypass logic or increase concurrency without explicit instruction. Key env vars for pacing:

```
BILIBILI_CRAWLER_MIN_DELAY_MS=900
BILIBILI_CRAWLER_JITTER_MS=700
BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS=45000
BILIBILI_CRAWLER_CACHE_TTL_MS=120000
```

### WBI-mode harvest (no Bilibili cookie required)

`run-bilibili-auto-coverage-wbi.ps1` runs the coverage loop without `BILIBILI_COOKIE`: the crawler auto-detects the missing cookie and switches to WBI-signed search, and Bilibili HTTP egresses through a Decodo CN residential proxy (looks organic, avoids geo-blocks and v_voucher anti-bot).

- Decodo credentials live in `set-decodo-env.ps1` (gitignored) → `BILIBILI_PROXY_LIST` (one sticky-session proxy URL ≈ one CN IP per ~60 min).
- Proxy wiring is in `server/services/bilibiliCrawler.js` (`initBilibiliProxyDispatcher` / `applyBilibiliProxy`), the single choke point for all Bilibili HTTP. **Gotcha:** the undici `ProxyAgent` dispatcher must be paired with undici's own `fetch` (not the global fetch) or it throws `UND_ERR_INVALID_ARG` — do not "simplify" that swap away.
- DeepSeek traffic stays direct (separate fetch path), so proxying does not slow the DeepSeek bottleneck.

### Harvest loop tuning

- `-QueryConcurrency N` / `BILIBILI_HARVEST_QUERY_CONCURRENCY` (default 1): queries run through a bounded worker pool; the cycle is DeepSeek-bound, so N=4 ≈ 3× faster. Bilibili requests stay throttled by the shared token bucket.
- `BILIBILI_HARVEST_REASONING_EFFORT` **clobbers** `DEEPSEEK_REASONING_EFFORT` at `runCoverageHarvestLoop.js:25` — setting only `DEEPSEEK_REASONING_EFFORT` is silently ignored. Use the PS1 `-ReasoningEffort` param, which sets both.
- `BILIBILI_COVERAGE_LOOP_MAX_CYCLES` is capped at 1000 (was 50 — a long-standing off-by-cap bug where the loop exited early).
- A logged-in `BILIBILI_COOKIE` still gives 5–10× higher Bilibili rate limits — the single biggest speedup when available.

## Coverage Checkpoint System (Power-Loss Safety)

Harvested dictionary/state files live only on disk between commits, and a power loss can zero unflushed NTFS writes. Two defense layers:

1. **Atomic writes** (`writeJsonFileAtomic` / `writeSerializedAtomic` in `server/services/deepseekKeywordTrainer.js`): temp-file → fsync → rename → fsync(parentDir).
2. **20-minute git checkpoints** (`server/services/coverageCheckpoint.js`): snapshots dictionary + state to the `coverage-checkpoints` branch via `commit-tree` + `update-ref` plumbing (advances that branch without moving HEAD). Bounded to ~72 snapshots (~24h).

`runCoverageHarvestWatchdog.js` auto-restores the latest checkpoint after crashes before relaunching. Manual recovery:

```bash
node server/scripts/restoreCoverageCheckpoint.js --list            # list snapshots
node server/scripts/restoreCoverageCheckpoint.js --restore <sha>   # restore specific (refuses while harvest runs)
node server/scripts/restoreCoverageCheckpoint.js --restore-latest  # restore newest
```

Config: `BILIBILI_COVERAGE_CHECKPOINT_INTERVAL_MS` (default 1200000), `BILIBILI_COVERAGE_CHECKPOINT_MAX_SNAPSHOTS` (72), `BILIBILI_COVERAGE_CHECKPOINT_DISABLE=1` to opt out.

**Stats staleness trap:** `npm run stats:update` reads the live dictionary/audit files, which frequently regress to the stale git-HEAD baseline after branch switches. Before running it, verify the entry count (`node -e "import('./server/services/deepseekKeywordTrainer.js').then(async m=>console.log((await m.readKeywordDictionary({})).entries.length))"`), and if stale, `--restore-latest` first. Never hand-edit `docs/stats/*.svg` — regenerate; see AGENTS.md §14 for the layout constants when modifying the generator.

## Parallel Worktree Pattern

For parallel dictionary resolution, the project uses `.claude/worktrees/` with independent git worktrees. After parallel runs, merge results with:

```powershell
node server/scripts/mergeAgentDictionaries.js .claude/worktrees/resolver-1 .claude/worktrees/resolver-2 .claude/worktrees/resolver-3
npm run dictionary:coverage
```

## Task Mining System

Long-running corpus mining jobs were historically defined in `.claude/tasks/*.json` and executed by `node .claude/resume_task.js`, each item checkpointed per-item so interruption loses zero progress. **Note:** the `.claude/tasks/` directory is currently absent from the repo (the Stop hook `stop-hub.cjs` tolerates its absence). If you need the pattern, see README.md "Multi-Round Corpus Mining" — recreate the task config if you relaunch it. Only one task should be active at a time.

## Context Compaction

### Compaction Failure Auto-Retry

This project follows the **global compaction-failure recovery protocol** defined
in `~/.claude/CLAUDE.md` (Compaction Failure Recovery section). When you detect
an empty or unusable response after compaction, respond with exactly `/compact`
and nothing else. Max 3 retries before surfacing to the user.

### Recovery on Resume

If you see `<system-reminder>` mentioning "context has been summarized" or
"continued from a previous conversation", and the context is usable, check for:
- `.claude/.compact_state.md` — auto-compact checkpoint (read FIRST)
- `.claude/.compact_state.json` — machine-readable state
- `.claude/MASTER_PLAN.md` — overall plan and current phase (if present)
- Any open `.claude/tasks/*.json` — active task state (if present)
- `.claude/personality_analysis_report_100.md` — last analysis results (if present)
