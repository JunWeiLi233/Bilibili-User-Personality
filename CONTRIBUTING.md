# Contributing to Bilibili User Personality

Thanks for your interest in contributing! This document outlines the conventions
and workflow for this project.

## Before You Start

1. Read `CLAUDE.md` at the repo root — it documents the project architecture,
   conventions, and common commands.
2. Read `README.md` for an overview of what the project does.
3. Check the [open issues](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues)
   to see if your idea is already being discussed.

## Development Setup

```powershell
# 1. Install dependencies
npm install

# 2. Copy and edit the DeepSeek env template
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
# Edit set-deepseek-env.ps1 with your real API key

# 3. Dot-source it so vars stay in the current shell
. .\set-deepseek-env.ps1
```

See `CLAUDE.md` > Environment Setup for full details.

## Architecture Overview

- **Frontend**: React 19 + Vite (`src/`)
- **Backend API**: Hono Node server (`server/`)
- **Python utilities**: Data-heavy corpus, coverage, scraping-plan, and analyzer
  work (`python_backend/`)
- **Compatibility boundary**: JSON payloads and CLI commands between
  `server/scripts/` and `python_backend/cli/`

The project is in a **hybrid JS + Python migration** phase. JavaScript keeps
app/API orchestration; Python should own data-heavy work once parity is proven.

## How to Contribute

### Reporting Bugs

Use the [Bug Report](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=bug_report.yml)
template. Include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, Python version)

### Suggesting Features

Use the [Feature Request](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=feature_request.yml)
template. Explain the use case and why it fits the project's research scope.

### Pull Requests

1. **Fork and branch** — create a feature branch from `main`.
2. **Follow TDD** — for behavior changes, write a failing test first, then
   implement the smallest fix. Run `npm test` and `npm run python:test`.
3. **JS/Python parity** — if you're migrating functionality from JS to Python,
   the Python CLI must produce identical JSON output to the JS counterpart.
   Run the relevant comparator (`npm run python:compare`) before opening the PR.
4. **No secrets** — never commit API keys, tokens, or cookies. Use environment
   variables exclusively. `set-deepseek-env.ps1` is gitignored.
5. **No generated data** — don't stage files from
   `server/data/deepseekKeywordDictionary.*/` or `server/data/keywordCoverage*`
   unless the PR explicitly harvests data.
6. **Use the PR template** — it includes a checklist that covers all conventions.

## Code Conventions

- **JS**: ESM (`"type": "module"`), Node built-in `node --test` runner.
- **Python**: Standard library + common packages. Tests use `unittest`.
- **Chinese text**: Many strings in `src/main.jsx` and `src/languageUnderstanding.js`
  have known encoding issues. Treat Chinese text edits carefully.
- **Crawler**: Intentionally conservative — sequential requests, brief caching,
  capped pages. Don't add bypass logic or increase concurrency without discussion.

## Testing

```powershell
npm test                    # All JS tests
npm run python:test         # All Python tests (68 skipped — Tieba scraper removed)

# Single JS test file
node --test server/services/bilibiliCrawler.test.js

# Single Python test
python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method
```

## Documentation-Only Changes

Documentation PRs must not modify business code. If you're improving docs,
keep the diff scoped to markdown files and comments only.

## Need Help?

Open a [Discussion](https://github.com/JunWeiLi233/Bilibili_User_Personality/discussions)
or ask in an issue. We're happy to help new contributors get started.
