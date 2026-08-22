# Contributing to Bilibili User Personality / 贡献指南

Thank you for your interest in contributing! This document explains the
conventions and workflow this project follows.

感谢你有意为本项目做贡献！本文档说明了本项目遵循的约定与工作流程。

## Before You Start / 开始之前

1. Read `CLAUDE.md` at the repository root — it documents the project's
   architecture, conventions, and common commands. / 阅读仓库根目录下的
   `CLAUDE.md`——其中记录了项目架构、开发约定与常用命令。
2. Read `README.md` for an overview of what the project does and why. / 阅读
   `README.md`，了解项目的目标与定位。
3. Browse the [open issues](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues)
   to see whether your idea is already being discussed. / 浏览
   [已有 issue](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues)，确认你的想法是否已在讨论中。

## Development Setup / 开发环境

```powershell
# 1. Install dependencies / 安装依赖
npm install

# 2. Copy and edit the DeepSeek env template / 复制并编辑 DeepSeek 环境变量模板
cp set-deepseek-env.example.ps1 set-deepseek-env.ps1
# Edit set-deepseek-env.ps1 with your real API key / 用你的真实 API key 编辑 set-deepseek-env.ps1

# 3. Dot-source it so the variables persist in the current shell / 点源加载，使变量在当前 shell 中生效
. .\set-deepseek-env.ps1
```

See `CLAUDE.md` > Environment Setup for full details. / 完整说明见 `CLAUDE.md`
的「Environment Setup」章节。

## Architecture Overview / 架构概览

- **Frontend**: React 19 + Vite (`src/`) / **前端**：React 19 + Vite（`src/`）
- **Backend API**: Hono Node server (`server/`) / **后端 API**：基于 Hono 的 Node 服务（`server/`）
- **Python utilities**: data-heavy corpus, coverage, scraping-plan, and analyzer
  work (`python_backend/`) / **Python 工具**：承担数据密集的语料、覆盖度、抓取计划与分析工作（`python_backend/`）
- **Compatibility boundary**: JSON payloads and CLI commands shared between
  `server/scripts/` and `python_backend/cli/` / **兼容边界**：`server/scripts/` 与 `python_backend/cli/` 之间共享的 JSON 负载与 CLI 命令

The project is in a **hybrid JS + Python migration** phase: JavaScript retains
app/API orchestration, while Python is taking over data-heavy work once parity
is proven.

本项目处于 **JS + Python 混合迁移** 阶段：JavaScript 保留应用与 API 的编排逻辑，Python 在通过一致性验证后逐步接管数据密集型工作。

## How to Contribute / 如何贡献

### Reporting Bugs / 报告 Bug

Use the [Bug Report](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=bug_report.yml)
template and include:

使用 [Bug Report](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=bug_report.yml)
模板，并提供：

- Steps to reproduce / 复现步骤
- Expected vs. actual behavior / 预期行为与实际行为
- Environment details (OS, Node version, Python version) / 环境信息（操作系统、Node 版本、Python 版本）

### Suggesting Features / 提出新功能

Use the [Feature Request](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=feature_request.yml)
template. Explain the use case and why it fits the project's research scope.

使用 [Feature Request](https://github.com/JunWeiLi233/Bilibili_User_Personality/issues/new?template=feature_request.yml)
模板，说明使用场景以及为何其符合项目的研究范围。

### Pull Requests / 合并请求（Pull Requests）

1. **Fork and branch** — create a feature branch from `main`. / **Fork 并新建分支**——从 `main` 创建功能分支。
2. **Follow TDD** — for behavior changes, write a failing test first, then
   implement the smallest fix. Run `npm test` and `npm run python:test`. /
   **遵循 TDD**——涉及行为变更时，先写一个失败的测试，再实现最小修复。运行 `npm test` 与 `npm run python:test`。
3. **JS/Python parity** — when migrating functionality from JS to Python, the
   Python CLI must produce JSON output identical to its JS counterpart. Run the
   relevant comparator (`npm run python:compare`) before opening the PR. /
   **JS/Python 一致性**——将功能从 JS 迁移到 Python 时，Python CLI 必须产出与 JS 端完全一致的 JSON。开 PR 前运行相应的比较器（`npm run python:compare`）。
4. **No secrets** — never commit API keys, tokens, or cookies; use environment
   variables exclusively. `set-deepseek-env.ps1` is gitignored. /
   **禁止提交密钥**——绝不提交 API key、token 或 cookie，一律使用环境变量。`set-deepseek-env.ps1` 已被 gitignore 忽略。
5. **No generated data** — do not stage files under
   `server/data/deepseekKeywordDictionary.*/` or `server/data/keywordCoverage*`
   unless the PR is explicitly about harvesting data. /
   **禁止提交生成数据**——除非 PR 明确涉及数据采集，否则不要暂存 `server/data/deepseekKeywordDictionary.*/` 或 `server/data/keywordCoverage*` 下的文件。
6. **Use the PR template** — it contains a checklist covering all conventions. /
   **使用 PR 模板**——其中包含覆盖全部约定的检查清单。

## Code Conventions / 代码约定

- **JS**: ESM (`"type": "module"`); tests use Node's built-in `node --test`
  runner. / **JS**：ESM（`"type": "module"`）；测试使用 Node 内置的 `node --test` 运行器。
- **Python**: standard library plus common packages; tests use `unittest`. /
  **Python**：标准库加常用第三方包；测试使用 `unittest`。
- **Chinese text**: many strings in `src/main.jsx` and `src/languageUnderstanding.js`
  have known encoding issues — edit Chinese text carefully. /
  **中文文本**：`src/main.jsx` 与 `src/languageUnderstanding.js` 中的许多字符串存在已知的编码问题，修改中文文本时请格外小心。
- **Crawler**: intentionally conservative — sequential requests, brief caching,
  capped pages. Do not add bypass logic or raise concurrency without prior
  discussion. / **爬虫**：刻意保持保守——顺序请求、短暂缓存、页数上限。未经讨论，请勿添加绕过逻辑或提高并发。

## Testing / 测试

```powershell
npm test                    # All JS tests / 全部 JS 测试
npm run python:test         # All Python tests (68 skipped — Tieba scraper removed) / 全部 Python 测试（68 个跳过——贴吧爬虫已移除）

# Single JS test file / 单个 JS 测试文件
node --test server/services/bilibiliCrawler.test.js

# Single Python test / 单个 Python 测试
python -m unittest python_backend.tests.test_corpus_contracts.TestClass.test_method
```

## Documentation-Only Changes / 仅文档类改动

Documentation PRs must not modify business code. Keep the diff limited to
Markdown files and comments.

仅文档类 PR 不得修改业务代码，请将改动限制在 Markdown 文件与注释范围内。

## Need Help? / 需要帮助？

Open a [Discussion](https://github.com/JunWeiLi233/Bilibili_User_Personality/discussions)
or ask in an issue — we're glad to help new contributors get started.

发起一个 [Discussion](https://github.com/JunWeiLi233/Bilibili_User_Personality/discussions)
或在 issue 中提问——我们很乐意帮助新贡献者上手。
