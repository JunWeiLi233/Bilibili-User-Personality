# AGENTS.md

This file defines syntax rules, coding conventions, and workflow rules that **every
coding agent** MUST follow when modifying this repository. It is agent-agnostic:
Claude Code, OpenCode, Codex, Cursor, Copilot, and any future agent must all obey
the same rules.

---


## 0. Agent Coordination Protocol (RUN FIRST)

### Session Start

Before doing anything else, EVERY agent MUST run:

    node .claude/agent-lock.js heartbeat "<your task description>"

- If output says **SOLO**: no other agents active. Edit freely. No locks needed.
- If output says **MULTI (N others)**: other agents detected. Enable file locks below.

### Before Editing Any File (MULTI mode only)

    node .claude/agent-lock.js acquire <file> "<task>"

If this FAILS (exit code 1), the file is locked by another agent. DO NOT edit it.
Options:
  - Skip: work on a different file
  - Isolate: `node .claude/agent-lock.js isolate "<task>"` for a worktree copy

### After Editing (MULTI mode only)

    node .claude/agent-lock.js release <file>

### Session End

    node .claude/agent-lock.js cleanup

---
## 1. Syntax Rules (MANDATORY 鈥?will crash/break if violated)

### 1.1 JavaScript 鈥?ESM Only

```js
// CORRECT
import assert from 'node:assert/strict';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { buildRiskLexiconText } from './languageUnderstanding.js';

// WRONG 鈥?will crash at runtime
const assert = require('node:assert');
const { serve } = require('@hono/node-server');
```

- Every `.js` file uses `import`/`export`. No `require()`. No `module.exports`.
- File extensions in imports are REQUIRED: `'./foo.js'` not `'./foo'`.
- Node built-ins use the `node:` prefix: `'node:assert'`, `'node:child_process'`.
- Dynamic imports use `await import('./foo.js')`.

### 1.2 Python 鈥?Explicit Package Paths Only

```py
# CORRECT
from python_backend.cli import coverage_audit as coverage_audit_cli
from pathlib import Path

# WRONG 鈥?implicit relative imports will break
from .cli import coverage_audit
```

- All CLI imports use full `python_backend.cli.*` path.
- Tests import modules as `import X as X_cli` pattern.
- No `from .X import Y` style relative imports.

### 1.3 File Extensions

- JS imports must include `.js` extension: `import { foo } from './bar.js'`.
- JSX files use `.jsx` extension.
- Python files use `.py`.
- Test files: `*.test.js` (JS) or `test_*.py` (Python).

---

## 2. File Structure Rules

### 2.1 Where Everything Goes

| If you are adding a... | Put it in... |
|---|---|
| Frontend UI / scoring / radar | `src/` |
| Backend API route | `server/routes/` |
| JS service / business logic | `server/services/` |
| JS CLI / script | `server/scripts/` |
| Shared JS utility | `server/utils/` |
| Python CLI entrypoint | `python_backend/cli/` |
| Python analysis logic | `python_backend/analysis/` |
| Python analyzer | `python_backend/analyzers/` |
| Python corpus / dict logic | `python_backend/corpus/` |
| Python scraper | `python_backend/scrapers/` |
| Python runtime helper | `python_backend/runtime/` |
| JS test | Same directory as source, `*.test.js` suffix |
| Python test | `python_backend/tests/`, `test_*.py` prefix |
| Generated JSON data | `server/data/` |
| Documentation | `docs/` or root `*.md` |
| Agent plans / state | `.claude/` |
| Autoresearch artifacts | `autoresearch/` |

### 2.2 Naming Conventions

- JS services: `camelCase.js` (e.g., `bilibiliCrawler.js`, `keywordHarvest.js`)
- Python CLIs: `snake_case.py` (e.g., `coverage_audit.py`, `tieba_keyword_scrape.py`)
- Test files: `sourceName.test.js` (JS) or `test_source_name.py` (Python)
- React components: PascalCase function, `camelCase.jsx` file
- Comparison scripts: `compare*.js` in `server/scripts/`
- JS indent: 2 spaces. Python indent: 4 spaces.

---

## 3. Test Conventions

### 3.1 JavaScript Tests (node --test, NOT Jest/Mocha)

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('descriptive name of what is being tested', async () => {
  const input = { ... };
  const result = await functionUnderTest(input);
  assert.equal(result.length, 2);
});

test('should handle edge case: empty input', () => {
  const result = functionUnderTest([]);
  assert.deepStrictEqual(result, []);
});
```

- Framework: `node:assert/strict` + `node:test` (built-in, no dependencies).
- Test file location: same directory as source, named `sourceName.test.js`.
- Run single file: `node --test server/services/bilibiliCrawler.test.js`
- Run all: `npm test`
- Run by pattern: `node --test --test-name-pattern="should handle rate limit" server/services/bilibiliCrawler.test.js`

### 3.2 Python Tests (unittest, NOT pytest)

```py
import unittest
from python_backend.cli import coverage_audit as coverage_audit_cli

class TestCoverageAudit(unittest.TestCase):
    def test_standalone_audit_produces_valid_json(self):
        result = coverage_audit_cli.run_standalone_audit(...)
        self.assertIsInstance(result, dict)
```

- Framework: `unittest` (standard library).
- Class naming: `Test<PascalCaseTarget>`.
- Method naming: `test_snake_case_description`.
- Run single: `python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method`
- Run all: `npm run python:test`

---

## 4. Secrets & API Keys (CRITICAL — NEVER EXPOSE)

### 4.1 The One Rule

**NEVER put a real API key, token, or secret in source code.** Not as a literal.
Not as a default argument. Not in a Python/JS/PS1 file. Not in a comment. Not anywhere
that gets committed to git.

```py
# WRONG — hardcoded fallback IS exposure
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-real-key-here")

# CORRECT — empty string or error-out
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
# or
API_KEY = os.environ["DEEPSEEK_API_KEY"]  # throws if missing, no fallback
```

```js
// WRONG — default value with real key
const apiKey = process.env.DEEPSEEK_API_KEY || 'sk-real-key-here';

// CORRECT
const apiKey = process.env.DEEPSEEK_API_KEY || '';
```

### 4.2 If You Generate a Script That Needs an API Key

1. **Read from env var only.** Never provide a default value that looks like a real key.
2. **Use `""` or throw** if the env var is missing. Do not guess.
3. **If the file contains ANY secret-like string** (`sk-*`, `Bearer *`, `token=*`, etc.),
   add it to `.gitignore` IMMEDIATELY before the first commit.
4. **If a sample is needed for the public repo**, create a separate `.example` file
   with placeholder text like `"put-your-api-key-here"`. Reference it in `README.md`.

### 4.3 What Counts as a Secret

- DeepSeek API key (`sk-...`)
- Bilibili cookie (`SESSDATA=...`, `bili_jct=...`)
- Baidu/Tieba cookie (`BDUSS=...`)
- Any `Authorization: Bearer ...` header value
- Admin tokens, JWT secrets, encryption keys
- Any string that grants access to an external service

### 4.4 Before Committing ANY New File

Run this mental checklist:
1. Does this file contain a string that looks like `sk-*`, `Bearer *`, `token=*`, or a cookie?
2. If yes → STOP. Replace with `""` or env-var lookup only.
3. Is this file listed in `.gitignore`? If it needs secrets at runtime but must stay local, gitignore it.
4. If this file is a template for others → name it `*.example.*` and use `"put-your-key-here"` placeholders.

---

## 5. Git Rules (MANDATORY)

### 5.1 NEVER Stage These

```
# Generated dictionary/coverage data (only stage when task explicitly says "commit harvested data")
server/data/deepseekKeywordDictionary.entries/*
server/data/deepseekKeywordDictionary.evidence/*
server/data/keywordCoverageAudit.json
server/data/keywordCoverageActions.json
server/data/keywordCoverageQueries.txt
server/data/keywordCoverageLoopReport.json
server/data/pythonContractComparison.json
server/data/randomVerificationReport.json

# Secrets (gitignored)
set-deepseek-env.ps1
run-bilibili-video.links.ps1

# Root-level orphan temp files
_browser_tieba_results.json
_danmaku_matches.json
db_selected*.json
extracted_uids*.json
all_entries.json
selected_users_report*.md
analyze_*_users.js
personality_analysis_data*.json
collect_uids.py
extract_uids.py
```

### 4.2 Commit Message Format

```
type: short description

- detail point 1
- detail point 2
```

Types: `feat`, `fix`, `migration`, `refactor`, `test`, `docs`, `chore`.

### 4.3 Branch Convention

- Feature: `feat/<short-description>`
- Fix: `fix/<short-description>`
- Branch from `main`. Never commit directly to `main`.

---

## 6. JS/Python Parity Convention (CRITICAL)

Python CLIs must produce IDENTICAL JSON outputs to their JS counterparts before
the JS path is retired. This is the single most important rule in the codebase.

```
1. Read existing JS implementation 鈫?JS output is the oracle
2. Run comparator: npm run python:compare (or server/scripts/compare*.js)
3. If mismatch 鈫?fix Python until output matches JS exactly
4. Only then 鈫?retire JS path
```

- Comparator scripts: `server/scripts/compare*.js`
- Migration inventory: `npm run python:migration-inventory`
- Random verification: `npm run python:verify-random`
- NEVER delete a JS implementation until the Python replacement passes the comparator.

---

## 7. Workflow Rules (MANDATORY)

### 6.1 Before Modifying Any Code

1. Read the relevant modules and their full call chain.
2. State: current behavior, proposed change, which files are affected, impact scope.
3. Get approval before implementing.

### 6.2 TDD for Behavior Changes

1. Write a failing test that demonstrates the bug or missing feature.
2. Verify it fails with `npm test` or `npm run python:test`.
3. Implement the smallest fix that makes it pass.
4. Run the full test suite 鈥?not just the file you changed.

### 6.3 Documentation-Only Tasks

- Must NOT modify business code. Only touch `*.md` files.

### 6.4 Chinese Text Handling

- `src/main.jsx` and `src/languageUnderstanding.js` have known encoding quirks from
  past round-trips.
- When editing Chinese strings: verify the file is UTF-8 after edits.
- Do not do broad find-and-replace across Chinese strings without explicit instruction.

---

## 8. Scraping & Rate Limiting (NEVER DISABLE)

The Bilibili crawler is intentionally conservative. Do NOT add bypass logic, increase
concurrency, or reduce delays without explicit instruction.

```
BILIBILI_CRAWLER_MIN_DELAY_MS=900
BILIBILI_CRAWLER_JITTER_MS=700
BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS=45000
BILIBILI_CRAWLER_CACHE_TTL_MS=120000
```

- Sequential requests only. No parallelism in crawler.
- Cooldown on rate-limit responses (HTTP 412, code -352, code -509).
- `fetchJson()` in `bilibiliCrawler.js` handles retry/backoff 鈥?do not bypass it.

---

## 9. Annotation Rules (for Behavioral Labeling Tasks)

When creating or reviewing behavioral labels:

### 8.1 Scale

| Score | Meaning | Criteria |
|-------|---------|----------|
| 0 | Not present | The behavior is absent from the comment |
| 1 | Somewhat present | Hinted at or partially expressed |
| 2 | Clearly present | Explicit and unambiguous |

### 8.2 Rules

1. **Label the text, not the person.** A comment exhibits a behavior; a person is not "a type."
2. **Use literal evidence.** Every label must be supportable by quoting the comment.
3. **Default to 0.** If unsure between 0 and 1, choose 0.
4. **Context over keywords.** A keyword match alone does not determine the label.
5. **Meme/quote awareness.** Self-directed memes, lyrics, quoted speech 鈮?argumentative behavior.

### 8.3 Inter-Annotator Agreement

- Minimum 2 independent annotators per comment.
- Target Cohen's 魏 鈮?0.6 (substantial agreement) per dimension.
- If 魏 < 0.6 for a dimension, refine its definition and re-label.
- Report 魏 alongside behavioral scores derived from labeled data.

---

## 10. Environment Setup (First Run)

```powershell
# 1. Copy and edit the DeepSeek env template
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
# Edit set-deepseek-env.ps1 with your real API key

# 2. Dot-source it (not just execute) so vars stay in the current shell
. .\set-deepseek-env.ps1

# 3. Install
npm install

# 4. Start
npm run server              # Hono API (port 8787) + Vite dev server (port 5191)
npm run dev                 # Vite only 鈥?backend must already be running
```

Required env vars: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`),
`DEEPSEEK_MODEL` (default `deepseek-v4-flash`), `DEEPSEEK_REASONING_EFFORT` (default `max`).

---

## 11. Quality Gate Checklist

Before considering work "done," verify:

- [ ] `npm test` 鈥?all JS tests pass
- [ ] `npm run python:test` 鈥?all Python tests pass
- [ ] `npm run build` 鈥?frontend builds without error
- [ ] No generated files staged (unless task explicitly requires it)
- [ ] No secrets committed — run: `git diff --cached | grep -E 'sk-[a-zA-Z0-9]{20,}|SESSDATA=|bili_jct=|BDUSS=|Bearer [A-Za-z0-9_\-]{20,}'` must return empty
- [ ] New files that reference API keys use env vars ONLY, with `""` fallback (never a real key)
- [ ] Comparator passes if migration code changed (`npm run python:compare`)
- [ ] Chinese text encoding verified if Chinese strings were edited
- [ ] Crawler rate limits respected if scraper code was touched

---

## 12. Key Entry Points (Quick Reference)

| What | Where |
|------|-------|
| Frontend SPA entry | `src/main.jsx` |
| Language analysis (axes, memes, quotes) | `src/languageUnderstanding.js` |
| Backend bootstrap + routes | `server/index.js` |
| Bilibili API routes | `server/routes/bilibili.js` |
| DeepSeek API routes | `server/routes/deepseek.js` |
| Bilibili crawler service | `server/services/bilibiliCrawler.js` |
| Keyword harvest service | `server/services/keywordHarvest.js` |
| DeepSeek keyword trainer | `server/services/deepseekKeywordTrainer.js` |
| Semantic matcher | `server/services/semanticMatcher.js` |
| Python keyword evidence | `python_backend/analyzers/keyword_evidence.py` |
| Python DeepSeek analyzer | `python_backend/analyzers/deepseek.py` |
| Coverage audit CLI | `python_backend/cli/coverage_audit.py` |
| Full architecture map | `docs/PROJECT_MAP.md` |
