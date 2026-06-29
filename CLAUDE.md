# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Facts

- Purpose: research prototype for analyzing public Bilibili comments, replies, and danmaku for bounded argumentative-behavior risk, not clinical diagnosis. See `README.md`.
- Note: Tieba (贴吧) scraper was fully removed (49 files, 68 skipped tests remaining as historical markers). Do not attempt to use Tieba scraping — it no longer exists.
- Stack: React 19 + Vite frontend in `src/`, Hono Node backend in `server/`, Python migration/backend utilities in `python_backend/`, JSON data contracts in `server/data/`.
- JS runtime: ESM (`"type": "module"` in `package.json`). Tests use Node's built-in `node --test` runner (not Jest/Mocha).
- Architecture direction: hybrid JS + Python. JavaScript keeps app/API orchestration; Python should own data-heavy corpus, coverage, scraping-plan, verification, and analyzer compatibility work once parity is proven.
- Compatibility boundary: JSON payloads and CLI commands between `server/scripts/` and `python_backend/cli/`.
- Detailed architecture and risks live in `docs/PROJECT_MAP.md`.

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

## Server Architecture

`npm run server` starts the Hono API on `http://127.0.0.1:8787` and auto-spawns Vite dev server on `http://127.0.0.1:5191` (unless `START_VITE=0`). Vite proxies `/api` requests to the Hono backend.

For standalone frontend dev: `npm run dev` starts Vite only (backend must already be running).

Routes are mounted under `/api/bilibili`, `/api/deepseek`, `/api/aicu`, and `/api/health`.

## Common Commands

```powershell
# Development
npm install
npm run server              # Hono API + Vite dev server
npm run dev                 # Vite only (needs backend running separately)
npm run build               # Vite production build

# Testing
npm test                    # All JS tests (node --test)
node --test server/services/bilibiliCrawler.test.js   # Single JS test file
node --test --test-name-pattern="should handle rate limit" server/services/bilibiliCrawler.test.js
npm run python:test         # All Python tests (68 skipped — Tieba scraper removed)
python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method  # Single Python test

# Dictionary & coverage
npm run dictionary:coverage          # Coverage audit → server/data/keywordCoverageAudit.json
npm run dictionary:auto              # Full auto-coverage harvest loop
npm run dictionary:prune             # General dictionary cleanup
npm run dictionary:prune-exhausted   # Prune terms with exhausted discovery
npm run dictionary:huggingface       # Hugging Face corpus import
npm run stats:update                 # Update README stats block + SVG graphs

# Python migration verification
npm run python:migration-inventory   # Current migration backlog and gates
npm run python:compare               # Compare JS vs Python contract outputs
npm run python:verify-random         # Random verification of evidence
```

## JS/Python Parity Convention

Migration follows a strict compare-before-replace pattern. Python CLIs must produce identical JSON outputs to their JS counterparts before the JS path is retired. Comparator scripts in `server/scripts/compare*.js` verify parity. Always run the relevant comparator after changing Python migration code.

## Key Entry Points

- Frontend: `src/main.jsx` (SPA entry, UI, scoring, radar wiring), `src/languageUnderstanding.js` (axis normalization, meme/quote handling)
- Backend API: `server/index.js` (Hono bootstrap), `server/routes/bilibili.js`, `server/routes/deepseek.js`, `server/routes/aicu.js`
- JS services: `server/services/` (crawler, keyword harvest, DeepSeek training, semantic matching, Hugging Face, local corpus)
- JS scripts/CLI: `server/scripts/` (discovery, coverage loops, merge tools, parity comparators)
- Python CLI: `python_backend/cli/` (coverage, corpus, scraping plans, analyzers, migration)
- Annotation pipeline: `.claude/annotation_data/` (κ labels, stratified candidates, reports), `server/scripts/extractStratifiedCandidates.js`
- Calibration: `python_backend/analysis/calibration.py` (learn_weights_from_labels, logistic regression over labeled data)
- Full directory map: `docs/PROJECT_MAP.md`

## Workflow Rules

- Before modifying code, read the relevant modules and call chain, then state current behavior, impact scope, and a modification plan.
- For behavior changes, use TDD: write/verify a failing test first, implement the smallest fix, then rerun relevant tests.
- Preserve JS behavior during migration. Add or update JS/Python comparison commands before replacing JS runtime paths.
- Do not stage generated files in `server/data/deepseekKeywordDictionary.*/` or `server/data/keywordCoverage*` unless the task explicitly asks for harvested data output.
- Do not commit secrets or real production config. **NEVER put a real API key, token, or cookie in source code** — not as a literal, not as a default argument, not in agent-generated scripts. Use env vars exclusively with `""` or error-out as fallback. `set-deepseek-env.ps1` contains API keys and is gitignored; use `set-deepseek-env.example.ps1` as the safe template with placeholder values. If you generate a new script that needs an API key: (a) read it from the environment only, (b) never provide a real key as a default, (c) if the file accidentally contains a secret-like string, add it to `.gitignore` immediately before committing.
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

## Parallel Worktree Pattern

For parallel dictionary resolution, the project uses `.claude/worktrees/` with independent git worktrees. After parallel runs, merge results with:

```powershell
node server/mergeAgentDictionaries.js .claude/worktrees/resolver-1 .claude/worktrees/resolver-2 .claude/worktrees/resolver-3
npm run dictionary:coverage
```

## Task Mining System

Long-running corpus mining jobs are defined in `.claude/tasks/*.json` and executed by `node .claude/resume_task.js`. Each task checkpoints progress per-item — interruption (rate-limit, session end, manual stop) loses zero progress. The Stop hook (`.claude/hooks/stop-hub.cjs`) blocks session exit until active tasks are marked done or deactivated.

Only one task should be active at a time. Edit the task config (`"active": true/false`) to switch. Available task types: `bilibili-seed-scrape`, `bilibili-keyword-search`, `bilibili-danmaku-deep`, `tieba-keyword-scrape` (Tieba scraper removed — tieba task is defunct). See README.md "Multi-Round Corpus Mining" for full operational details.

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
- `.claude/MASTER_PLAN.md` — overall plan and current phase
- Any open `.claude/tasks/*.json` — active task state
- `.claude/personality_analysis_report_100.md` — last analysis results
