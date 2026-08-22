## Repository Guidelines

### Project Structure & Module Organization

```
src/                  React 19 + Vite frontend
server/               Hono Node.js API backend (ESM)
  routes/             API route handlers (/api/bilibili, /api/deepseek, /api/health)
  services/           Business logic (crawler, dictionary, DeepSeek analysis)
  scripts/            Standalone CLI scripts (keyword harvesting, corpus mining)
  data/               JSON data contracts (dictionaries, corpus shards, audit reports)
  utils/              Shared helpers
python_backend/       Python utilities mirroring server logic
  cli/                Python CLI commands (coverage, scraping, migration compare)
  corpus/             Corpus management and evidence tracking
  scrapers/           Bilibili/Tieba crawlers
  analysis/           Statistical and semantic analysis
  runtime/            Rate limiting, caching, concurrency
  tests/              Python unit tests (unittest)
public/               Static assets
docs/                 Project documentation and stats SVG graphs
```

The project follows a hybrid JS + Python architecture. JavaScript owns the app/API orchestration; Python handles data-heavy corpus, coverage, scraping-plan, and verification work. JS and Python paths are validated against each other via contract comparison scripts under `server/scripts/compare*.js`.

### Build, Test, and Development Commands

| Command | Purpose |
|---|---|
| `npm run server` | Start Hono API (port 8787) + Vite dev server (port 5191) |
| `npm run dev` | Vite dev only (backend must run separately) |
| `npm run build` | Vite production build into `dist/` |
| `npm test` | All JS tests via `node --test` |
| `npm run python:test` | All Python tests via `unittest discover` |

Run a single JS test file: `node --test server/services/bilibiliCrawler.test.js`.  
Run a single Python test: `python -m unittest python_backend.tests.test_module.TestClass.test_method`.

### Coding Style & Naming Conventions

- JS is ESM (`"type": "module"`). Use `import`/`export`, not `require`.
- Indentation: 2 spaces for JS, 4 spaces for Python.
- Use `node --test` for JS tests — not Jest or Mocha.
- Python uses the standard `unittest` framework.
- JSON data contracts live in `server/data/` and are the compatibility boundary between JS and Python paths.

### Testing Guidelines

- JS tests use Node's built-in `node --test` runner. Test files follow the pattern `*.test.js`.
- Python tests live in `python_backend/tests/` and use `unittest`.
- New Python migrations must include a `compare*.js` script validating JS/Python output parity before the JS path is retired.

### Commit & Pull Request Guidelines

Commits follow conventional format: `type: short description`.  
Common types: `feat`, `fix`, `migration`, `chore`.

Examples from history:
```
feat: dictionary harvest coverage loop + Tieba mobile discovery fix
fix: infinite 429 retry loop + scoring divergence in localCorpusEvidence
migration: retire remaining 3 JS paths (harvestAllSeedCorpus, ...)
```

PRs should link related issues and include a summary of contract comparison results when migrating logic from JS to Python.
