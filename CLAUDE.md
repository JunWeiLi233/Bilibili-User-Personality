# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bilingual (Chinese/English) research prototype that evaluates whether a Bilibili user's public comments show argumentative-trolling tendency. Produces a radar chart across six behavioral dimensions derived from lexicon matching, semantic analysis, and DeepSeek LLM judgment.

## Quick Commands

```bash
# Development (starts backend :8787 + Vite frontend :5191 with /api proxy)
npm run dev:full

# Frontend only (Vite dev server)
npm run dev

# Backend only (Hono server)
npm run server

# Tests (Node.js built-in test runner, auto-discovers *.test.js)
npm test

# Run a single test file
node --test server/services/bilibiliCrawler.test.js

# Production build
npm run build
```

## Environment Setup

No `.env` file. Config is via PowerShell scripts (gitignored):

```powershell
# Copy template, fill in DeepSeek API key
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
.\set-deepseek-env.ps1   # source env vars before starting server
```

Required vars: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `DEEPSEEK_MODEL` (default `deepseek-v4-flash`).

## Architecture

**ESM throughout** (`"type": "module"` in package.json).

### Frontend (React 19 + Vite 7)

- Single-file SPA: `src/main.jsx` contains all UI and client-side analysis logic (`scoreComments`, lexicon matching, speech-act classification, radar scoring).
- `src/languageUnderstanding.js` — exported helpers for risk lexicon text, meme detection, radar marks.
- `src/styles.css` — plain CSS, no preprocessor.
- Vite proxy: `/api` → `http://127.0.0.1:8787`.

### Backend (Hono 4 on Node.js)

- Entry: `server/index.js` — Hono app on port 8787 (configurable via `PORT`).
- Routes in `server/routes/`:
  - `/api/bilibili` — UID analysis, video keyword scraping
  - `/api/deepseek` — config, dictionary, comment analysis, keyword training
  - `/api/aicu` — comment scraping from aicu.cc
- Services in `server/services/`:
  - `bilibiliCrawler.js` — Bilibili API scraping (sequential, rate-limited, cached)
  - `deepseekKeywordTrainer.js` — DeepSeek-powered keyword extraction
  - `keywordHarvest.js` — harvesting pipeline orchestrator
  - `videoKeywordSearch.js` — video search + comment scanning
  - `semanticMatcher.js` — `@xenova/transformers` cosine similarity (model: `Xenova/all-MiniLM-L6-v2`, threshold 0.72)
- Utils in `server/utils/paths.js` — centralized path constants for all data files.
- Scripts in `server/scripts/` — CLI tools for dictionary harvesting, audit, pruning, merging.

### Data Flow

1. Frontend sends UID/video URL to backend API
2. Backend scrapes Bilibili comments, optionally trains keywords via DeepSeek
3. Frontend runs `scoreComments()` client-side to generate radar chart
4. On startup, frontend loads dictionary from `GET /api/deepseek/dictionary`

### Persistent Data (JSON, in `server/data/`)

- `deepseekKeywordDictionary.json` — the keyword dictionary (~1593 terms)
- `keywordHarvestState.json` — harvesting progress state
- `semanticTermEmbeddings.json` — cached 384-dim embedding vectors
- Coverage audit reports and action files

## Dictionary Scripts

```bash
npm run dictionary:coverage    # audit coverage against Bilibili comments
npm run dictionary:harvest     # discover keywords from videos
npm run dictionary:prune       # clean up dictionary
npm run dictionary:prune-exhausted  # remove unprovable terms
npm run dictionary:resolve-near     # resolve terms near evidence target
npm run dictionary:auto        # full automated coverage loop
```

PowerShell automation: `.\run-bilibili-auto-coverage.ps1` (orchestrates cycles of audit → harvest → validate → prune).

## Testing

Uses Node.js built-in test runner (`node:test` + `node:assert/strict`). No Jest/Vitest. 13 test files co-located with their source files. `npm test` auto-discovers all `*.test.js` files.

## Key Conventions

- Crawler is intentionally conservative: sequential requests, brief caching, cooldown on rate limits. Never bypass pacing.
- Coverage evidence must come from Bilibili public comments, replies, or danmaku — not search-result titles or third-party sources.
- DeepSeek is used as a keyword extractor and sentence-context judge, not for fine-tuning local models.
- Dictionary terms include `evidenceCount`, `evidenceSamples`, and `evidenceSources` for auditability.
- Semantic matching supplements (never replaces) exact substring matching.
