# CLAUDE.md

Persistent guidance for Claude Code and DeepSeek sessions. Keep this file short; detailed architecture and risks live in `docs/PROJECT_MAP.md`.

## Project Facts

- Purpose: research prototype for analyzing public Bilibili/Tieba comments, replies, and danmaku for bounded argumentative-behavior risk, not clinical diagnosis. See `README.md`.
- Stack: React 19 + Vite frontend in `src/`, Hono Node backend in `server/`, Python migration/backend utilities in `python_backend/`, JSON data contracts in `server/data/`.
- Architecture direction: hybrid JS + Python. JavaScript keeps app/API orchestration; Python should own data-heavy corpus, coverage, scraping-plan, verification, and analyzer compatibility work once parity is proven.
- Compatibility boundary: JSON payloads and CLI commands between `server/scripts/` and `python_backend/cli/`.

## Workflow Rules

- Before modifying code, read the relevant modules and call chain, then state current behavior, impact scope, and a modification plan.
- For behavior changes, use TDD: write/verify a failing test first, implement the smallest fix, then rerun relevant tests.
- Preserve JS behavior during migration. Add or update JS/Python comparison commands before replacing JS runtime paths.
- Do not stage generated `server/data/**` artifacts unless the task explicitly asks for harvested data output.
- Do not commit secrets or real production config. Keep DeepSeek keys in local environment setup only.
- Documentation-only tasks must not modify business code.

## Common Commands

```powershell
npm install
npm run dev
npm run server
npm run build
npm test
npm run python:test
npm run python:compare
npm run python:migration-inventory
npm run python:verify-random
npm run stats:update
```

## Key Entry Points

- Frontend app and client analysis: `src/main.jsx`, `src/languageUnderstanding.js`.
- Backend API: `server/index.js`, `server/routes/`.
- JS services and legacy runtime logic: `server/services/`.
- JS CLI wrappers and parity comparators: `server/scripts/`.
- Python CLI and migration target: `python_backend/cli/`.
- Python analysis/corpus/scraper/analyzer modules: `python_backend/analysis/`, `python_backend/corpus/`, `python_backend/scrapers/`, `python_backend/analyzers/`.
- Full project map: `docs/PROJECT_MAP.md`.
