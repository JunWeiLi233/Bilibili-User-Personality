# JS → Python Backend Migration Plan

Last updated: 2026-06-25. Run `python -m python_backend.cli.migration_inventory` for latest.

## Current Status

| Metric | Count |
|--------|-------|
| Total JS backend files | 126 |
| Already ported or retained (JS orchestration) | 102 |
| Remaining migration candidates | 24 |
| Python analysis modules | ~10,900 lines |
| Python corpus modules | ~6,750 lines |
| Python scraper modules | ~8,250 lines |
| Python test lines | ~39,000 lines |
| JS↔Python compare scripts | 134 |
| JS↔Python comparison tests | 278 (all passing) |
| Python unit tests | 1,629 |
| JS unit tests (npm test) | 1,303 |

## Phase 1: Core Python Contracts (COMPLETE)

Python modules for the foundational pipelines, with JS↔Python comparison validation.

### Coverage Auditing
- `analysis/audit.py` — Core audit builder, report, evidence profile (661 lines)
- `analysis/coverage_audit_metrics.py` — GATE/metric contracts
- `analysis/coverage_audit_output.py` — JSON output/writer contracts
- `analysis/coverage_audit_artifacts.py` — Artifact serialization
- `analysis/coverage_audit_comparison.py` — Comparator contracts
- `analysis/coverage_evidence_profile.py` — Evidence normalization
- `analysis/coverage_harvest_loop_plan.py` — Harvest loop plan contracts
- `analysis/coverage_harvest_loop_runtime.py` — Runtime adapters/gates
- `analysis/coverage_harvest_loop_command.py` — Command runner + CLI
- `analysis/coverage_cli_options.py` — CLI option parsing (JS port)
- `analysis/video_comment_filter.py` — Comment filtering + video relevance + 5 default constants + config resolution (18/18 videoKeywordSearch.js exports ported)
- Comparison: `node server/scripts/compareCoverageHarvestLoopCommand.js` + 133 others
- Tests: 1,522 Python contract tests, 1,303 JS tests

### Random Verification
- `analysis/random_assembly.py` — Corpus assembly
- `analysis/random_corpus.py` — Corpus contract
- `analysis/random_sampling.py` — Sampling/run options
- `analysis/random_execution.py` — Execution contracts
- `analysis/random_request.py` — Request dispatching
- `analysis/random_compare.py` — Comparator
- `analysis/random_output.py` — JSON output writing
- `analysis/random_report.py` — Report summary
- `analysis/random_readiness.py` — Readiness selection
- `analysis/random_readiness_result.py` — Readiness results
- Comparison: `node server/scripts/compareRandomVerification.js`

### JSON Corpus Loading
- `corpus/loader.py` — Monolithic + shard corpus reading
- `corpus/writer.py` — Shard writing with bounded chunks
- `corpus/contracts.py` — Corpus update contracts
- `corpus/dictionary.py` — Dictionary loader
- `corpus/tieba.py` — Tieba corpus updates
- `corpus/huggingface.py` — HuggingFace corpus import
- `corpus/history_tags.py` — Bilibili history tag corpus
- `corpus/local.py` — Local corpus evidence mining
- `corpus/direct_probe.py` — Direct probe corpus
- Comparison: `node server/scripts/compareCorpusShardWrite.js`

### JSON Output Writing
- `analysis/coverage_audit_output.py` — `CoverageAuditOutputWriter`
- `analysis/random_output.py` — `RandomVerificationOutputWriter`
- `runtime/json_contracts.py` — `JsonResultBytesContract` base class
- All Python output validates against JS output via 134 compare scripts.

### JS↔Python Comparison Path
- **Programmatic (subprocess):** `python_backend/tests/test_video_filter_compare.py` — runs JS via Node, asserts identical Python output
- **CLI comparison:** 134 `server/scripts/compare*.js` scripts validate Python CLI output vs JS CLI output
- **Contract tests:** `test_corpus_contracts.py` validates Python contracts match JS JSON shapes

### How to Verify Phase 1
```powershell
python -m unittest python_backend.tests.test_corpus_contracts  # 1,522 tests
python -m unittest python_backend.tests.test_video_filter_compare  # 37 JS↔Python comparisons
python -m unittest python_backend.tests.test_analyzers  # 70 tests
npm test  # 1,303 JS tests
python -m python_backend.cli.migration_inventory  # Reports migration progress
```

## Phase 2: Scraping & Rate Limiting (IN PROGRESS)

### Completed
- `scrapers/rate_limiter.py` — Rate limiter with configurable delays
- `scrapers/adapters.py` — Scraper adapters
- `scrapers/tieba_timing.py` — Tieba scrape timing
- `scrapers/scraper_monitor.py` — Scraper monitoring
- `scrapers/bilibili_crawler.py` — Bilibili crawler helpers: cookie forge, request scheduling, reply collection, danmaku parsing, UID analysis, dynamic records (1,437 lines, all helper functions ported; comparison tests pass)

### Remaining Migration Candidates
| File | Lines | Priority |
|------|-------|----------|
| `server/services/bilibiliCrawler.js` | 1,137 | High — last crawler module |
| `server/services/videoKeywordSearch.js` | 1,286 | High — 18/18 exports ported: `searchVideoKeywords` config resolution extracted as `resolve_search_video_keywords_config`; async orchestration stays JS |
| `server/services/keywordHarvest.js` | 3,540 | Medium |
| `server/services/deepseekKeywordTrainer.js` | 4,662 | **Data-driven rule engine** — `normalize_keyword_entries` fully ported (20+ helpers + main function); `normalizeDeepSeekAnalysisResult` ported; `extractJsonObject` ported; `keyword_evidence.py`: ~1,188 lines; `ambig_benign_rules.json`: 167 extracted rules evaluated by Python (extractor enhanced to handle multi-line consts, inline regex, parenthesized OR, composite conditions); 8 remaining rules use patterns not yet handled by extractor |
| `server/scripts/runCoverageHarvestLoop.js` | 695 | High — loop orchestration |
| `server/scripts/runTiebaKeywordScrape.js` | 390 | Medium |
| 18 more scripts | ~6,250 total | Low — CLI wrappers |

## Phase 3: Analyzer Clients (IN PROGRESS)

- `analyzers/deepseek.py` — DeepSeek analysis config + planning + normalization (1,278 lines)
- `analyzers/deepseek_cli.py` — CLI dispatch (944 lines)
- `analyzers/deepseek_config.py` — Configuration contracts (189 lines)
- `analyzers/keyword_evidence.py` — Keyword evidence analysis + dictionary entry normalization helpers + `normalize_keyword_entries` main function (1,188 lines, fully ported)
- Tests: `python_backend/tests/test_analyzers.py` (70 tests covering normalize, config, validation, normalization, keyword evidence)
- JS↔Python comparison: 28 DeepSeek comparison tests pass (config, normalization, validation, fixture, mock runtime, plan, command)
- `normalizeDeepSeekAnalysisResult` ported as `DeepSeekAnalysisNormalizer.normalize()` (line 656)
- `normalize_keyword_entries` fully ported to `keyword_evidence.py` (line 1014) — main function + 20+ helper functions + 167 JSON rule evaluations
- `_is_ambiguous_benign_evidence_sample` evaluates 167 extracted rules from `ambig_benign_rules.json` with composite condition support

## Phase 4: Replace JS Commands (FUTURE)

Only after all Phase 2-3 Python modules pass comparison validation on real Bilibili/Tieba corpus data.

## Guard Rails

These apply to every migration step and are enforced in CLAUDE.md:

1. **TDD required**: write failing test → implement → verify green
2. **JS must stay green**: `npm test` before every commit
3. **Never stage `server/data/`**: generated artifacts are not migration code
4. **No live scraping**: no Bilibili, Tieba, DeepSeek, Kaggle, or HuggingFace API calls during migration
5. **JSON contracts as boundary**: Python and JS communicate via identical JSON shapes
6. **Compare before replace**: every Python replacement must pass a JS↔Python comparison test first
7. **Incremental**: port one function or one class at a time, commit after each
