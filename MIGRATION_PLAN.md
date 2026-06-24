# JS → Python Backend Migration Plan

State as of 2026-06-24. Generated from `python -m python_backend.cli.migration_inventory`.

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
| Python unit tests | 1,523 |
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
- `analysis/video_comment_filter.py` — Comment filtering + video relevance (JS port)
- Comparison: `node server/scripts/compareCoverageHarvestLoopCommand.js` + 133 others
- Tests: 1,523 Python contract tests, 1,303 JS tests

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
python -m unittest python_backend.tests.test_corpus_contracts  # 1,523 tests
python -m unittest python_backend.tests.test_video_filter_compare  # JS↔Python comparison
npm test  # 1,303 JS tests
python -m python_backend.cli.migration_inventory  # Reports migration progress
```

## Phase 2: Scraping & Rate Limiting (IN PROGRESS)

### Completed
- `scrapers/rate_limiter.py` — Rate limiter with configurable delays
- `scrapers/adapters.py` — Scraper adapters
- `scrapers/tieba_timing.py` — Tieba scrape timing
- `scrapers/scraper_monitor.py` — Scraper monitoring
- `scrapers/bilibili_crawler.py` — Bilibili crawler (partial)

### Remaining Migration Candidates
| File | Lines | Priority |
|------|-------|----------|
| `server/services/bilibiliCrawler.js` | 1,137 | High — last crawler module |
| `server/services/videoKeywordSearch.js` | 1,286 | High — 10/18 exports remain |
| `server/services/keywordHarvest.js` | 3,540 | Medium |
| `server/services/deepseekKeywordTrainer.js` | 4,662 | Medium |
| `server/scripts/runCoverageHarvestLoop.js` | 695 | High — loop orchestration |
| `server/scripts/runTiebaKeywordScrape.js` | 390 | Medium |
| 18 more scripts | ~3,500 total | Low — CLI wrappers |

## Phase 3: Analyzer Clients (PLANNED)

- `analyzers/deepseek.py` — DeepSeek analysis config + planning (1,278 lines)
- `analyzers/deepseek_cli.py` — CLI dispatch (944 lines)
- `analyzers/deepseek_config.py` — Configuration contracts
- `analyzers/keyword_evidence.py` — Keyword evidence analysis
- Remaining: full DeepSeek runtime contract expansion

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
