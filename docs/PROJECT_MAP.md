# Project Map

This document records the detailed architecture for future agents. Keep session-level rules in `CLAUDE.md`; keep deeper project facts here.

## 1. Project Purpose and Stack

- `README.md`: the project is a research-driven prototype that evaluates whether selected public Bilibili user comments show high argumentative-trolling tendency. It presents a radar-style behavior-risk view across adversarial motivation, cognitive closure, evidence sensitivity, logical consistency, cooperative discussion, and correction willingness.
- `README.md`: supported evidence should come from Bilibili public comments, replies, or danmaku unless a task explicitly selects looser discovery mode. Search titles can assist discovery but are not strict evidence.
- `README.md`: DeepSeek is used for keyword extraction and sentence-context judgment; it is not a local fine-tuning pipeline.
- `package.json`: the JavaScript runtime is ESM (`"type": "module"`), with React 19, Vite 7, Hono 4, `@hono/node-server`, and `@xenova/transformers`.
- `package.json`: Python is used through module CLIs under `python_backend/cli/` for coverage, corpus, scraping-plan, migration, verification, and analyzer work.
- `server/index.js`: backend listens on `127.0.0.1:8787` by default and can spawn Vite on `127.0.0.1:5191`.

## 2. Directory and Module Responsibilities

- `src/main.jsx`: React SPA entry. It contains the main UI, mode selection, client-side scoring flow, and radar output wiring.
- `src/languageUnderstanding.js`: shared frontend language-analysis helpers, axis normalization, meme/quote handling, and risk evidence helpers.
- `src/styles.css`: frontend styling.
- `server/index.js`: Hono app bootstrap, CORS, error handler, route mounting, Vite child process, and shutdown handling.
- `server/routes/bilibili.js`: Bilibili-facing API routes for UID/video/comment flows.
- `server/routes/deepseek.js`: DeepSeek configuration, dictionary, analysis, and training routes.
- `server/routes/aicu.js`: AICU-related route surface kept separate from direct Bilibili flows.
- `server/services/`: JS runtime services for crawling, keyword harvest, DeepSeek keyword training, semantic matching, local corpus evidence, Hugging Face corpus import, history tags, split corpus storage, polysemy disambiguation (`disambiguator.js`), context classification (`contextClassifier.js`), comment coverage pipeline (`commentCoverage.js`), relationship analysis pipeline (`relationshipPipeline.js`), statistical co-occurrence (`termCooccurrence.js`), LLM-based relation analysis (`llmRelationAnalysis.js`), and unified scraper configuration (`scraperConfig.js`). (Tieba scraper removed — 49 files deleted.)
- `server/scripts/`: CLI wrappers, data tools, migration bridges, and JS/Python parity comparators. Files named `compare*.js` usually verify Python output against current JS behavior.
- `server/utils/`: shared JS utilities for paths, coverage CLI/progress handling, file locks, and discovery reports/options.
- `server/data/`: generated JSON state, dictionaries, corpus shards, coverage reports, and comparison artifacts. Treat this as generated unless a task explicitly asks to update harvested data.
- `python_backend/cli/`: Python command entrypoints invoked by `package.json` scripts and JS bridge code.
- `python_backend/analysis/`: coverage audits, coverage-loop planning, migration inventory, README stats, random verification, semantic matching, reporting logic, context classification (`context_classifier.py`), polysemy audit (`polysemy_audit.py`), calibration (`calibration.py`), validation metrics (`validation_metrics.py`), and metrics pipeline (`compute_metrics_pipeline.py`).
- `python_backend/analyzers/`: DeepSeek analyzer planning, runtime validation, keyword evidence, and analyzer compatibility logic.
- `python_backend/corpus/`: corpus loaders/writers, dictionary operations, local/Hugging Face/history-tag/direct-probe corpus transformations, and merge-agent dictionary planning. (Tieba corpus modules removed.)
- `python_backend/runtime/`: JSON contract and file-lock helpers shared by Python commands.
- `python_backend/scrapers/`: Python scraper planners/adapters for Bilibili, AICU, UID/range/batch pipelines, browser-driven helpers, rate limiting, and scraper monitoring. (Tieba scraper modules removed.)
- `python_backend/tests/`: Python contract tests. `python_backend/tests/test_corpus_contracts.py` is the main migration contract test file.
- `docs/stats/`: generated README graph assets and stats data updated by `npm run stats:update`.
- `.github/workflows/update-stats-graph.yml`: automatic README stats graph refresh.
- `.github/workflows/python-validation.yml`: Python validation workflow.

## 3. Key Call Chains and Data Flow

- App startup: `npm run server` runs `server/index.js`, mounts `server/routes/bilibili.js`, `server/routes/deepseek.js`, and `server/routes/aicu.js`, then starts Vite unless `START_VITE=0`.
- Frontend analysis: `src/main.jsx` loads UI state, pulls dictionary/config data from backend DeepSeek routes, uses helpers from `src/languageUnderstanding.js`, and renders score/radar output.
- Bilibili API flow: frontend requests hit `server/routes/bilibili.js`, which delegates to services such as `server/services/bilibiliCrawler.js`, `server/services/videoKeywordSearch.js`, `server/services/keywordHarvest.js`, and corpus/evidence services.
- DeepSeek flow: `server/routes/deepseek.js` and `server/scripts/analyzeDeepSeekComments.js` provide the JS-facing analyzer surface. Python equivalents live under `python_backend/analyzers/` and `python_backend/cli/deepseek_*`.
- Coverage flow: `npm run dictionary:coverage` calls `python_backend.cli.coverage_audit`, writes audit/query/action artifacts under `server/data/`, and supports standalone coverage auditing.
- Coverage loop bridge: `npm run dictionary:auto` calls `server/scripts/runCoverageHarvestLoop.js`; migration parity is checked by commands such as `npm run python:coverage-loop-command-compare`.
- Tieba flow: REMOVED. The Tieba scraper (49 files: JS services, Python CLI, corpus, scrapers) was deleted. 68 Python tests are skipped with `@unittest.skip("Tieba scraper removed")`. The `.claude/tasks/tieba_scrape.json` task config is defunct.
- Hugging Face/local corpus flow: `npm run dictionary:huggingface`, `npm run dictionary:mine-local`, and related `python:local-*` commands use Python corpus modules to import or mine external/local text sources.
- Stats flow: `npm run stats:update` calls `python_backend.cli.readme_stats`, updates the README stats block and `docs/stats/*.svg`/JSON outputs. GitHub Actions refresh this automatically.
- Migration flow: JS scripts remain the compatibility oracle until a Python CLI reaches parity. `server/scripts/compare*.js` commands compare JS and Python outputs, while `npm run python:migration-inventory` reports migration scope and gates.
- Polysemy disambiguation flow: `server/services/commentCoverage.js` → `server/services/disambiguator.js` (rule-based composite patterns from `server/data/disambiguation_rules.json`) → `server/services/contextClassifier.js` (scenario classification for sense biasing) → `server/services/relationshipPipeline.js` (3-tier: composites → co-occurrence → LLM). Evaluation via `server/scripts/evalPolysemy.js`. Python equivalent for context classifier at `python_backend/analysis/context_classifier.py`.

## 4. Local Commands

Install and run:

```powershell
npm install
.\set-deepseek-env.ps1
npm run server
npm run dev
```

Build and test:

```powershell
npm run build
npm test
npm run python:test
```

Migration and verification:

```powershell
npm run python:migration-inventory
npm run python:compare
npm run python:verify-random
npm run python:coverage-standalone
```

Data/corpus operations:

```powershell
npm run dictionary:coverage
npm run dictionary:auto
npm run dictionary:tieba
npm run dictionary:huggingface
npm run dictionary:history-tags
npm run stats:update
```

DeepSeek setup:

```powershell
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
.\set-deepseek-env.ps1
```

Keep real API keys out of git.

## 5. Current Architecture Issues, Risks, and Unknowns

- `README.md`, `src/main.jsx`, and `src/languageUnderstanding.js`: terminal output shows mojibake/encoding damage in many Chinese strings. Treat Chinese text edits carefully and verify encoding before broad rewrites.
- `src/main.jsx`: the SPA still mixes UI, scoring, labels, lexicon data, and request orchestration in one large entry file. Future frontend work should split behavior logic from rendering.
- `server/services/` and `server/scripts/`: many JS files still own runtime behavior. Python migration should proceed through parity tests and explicit bridge flags rather than direct rewrites.
- `python_backend/analysis/migration_inventory.py`: use `npm run python:migration-inventory` to get the current authoritative migration backlog and next gates before planning migration work.
- `server/data/`: many files are generated by harvest, coverage, stats, and verification commands. Avoid committing incidental data churn.
- `set-deepseek-env.ps1`: local environment file may contain secrets and must not be committed. Use `set-deepseek-env.example.ps1` as the safe template.
- `README.md` and `docs/stats/`: stats graphs are generated. Manual edits inside the generated stats block may be overwritten by `npm run stats:update` or GitHub Actions.
- Public scraping code in `server/services/` and `python_backend/scrapers/`: preserve conservative pacing/rate-limit behavior. Do not add bypass logic.
- DeepSeek live validation depends on external credentials and service availability. Prefer mock/fixture/plan comparators unless the task explicitly requires live validation.
