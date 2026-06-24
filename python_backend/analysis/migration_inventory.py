from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BACKEND_CATEGORY_PREFIXES = {
    "scripts": "server/scripts/",
    "services": "server/services/",
    "routes": "server/routes/",
    "utils": "server/utils/",
}

DEFAULT_PACKAGE_COMMAND_EQUIVALENTS = {
    "video:keywords": "python:harvest-plan",
    "dictionary:harvest": "python:harvest-plan",
    "dictionary:coverage": "python:coverage-standalone",
    "dictionary:prune": "python:dictionary-prune-summary",
    "dictionary:prune-exhausted": "python:exhausted-prune-plan",
    "dictionary:resolve-near": "python:near-target-plan",
    "dictionary:auto": "python:coverage-loop-command",
    "dictionary:tieba": "python:tieba-keyword-plan",
    "dictionary:huggingface": "python:huggingface-import",
    "dictionary:mine-local": "python:local-mine",
    "dictionary:probe-bilibili": "python:direct-probe-command",
    "dictionary:history-tags": "python:history-tags",
    "deepseek:analyze": "python:deepseek-analyze",
    "aicu:scrape": "python:aicu-plan",
    "aicu:batch": "python:aicu-batch-plan",
    "uid:discovery": "python:uid-discovery-plan",
    "uid:range": "python:uid-range-scrape-plan",
    "stats:update": "python:readme-stats",
}

DEFAULT_PACKAGE_VALIDATION_EQUIVALENTS = {
    "video:keywords": "python:harvest-plan-compare",
    "dictionary:harvest": "python:harvest-plan-compare",
    "dictionary:prune": "python:dictionary-prune-compare",
    "dictionary:prune-exhausted": "python:exhausted-prune-compare",
    "dictionary:resolve-near": "python:near-target-compare",
    "dictionary:auto": "python:coverage-loop-command-compare",
    "dictionary:tieba": "python:tieba-keyword-compare",
    "dictionary:probe-bilibili": "python:direct-probe-command-compare",
    "deepseek:analyze": "python:deepseek-analyze-command-compare",
    "dictionary:huggingface": "python:huggingface-compare",
    "dictionary:mine-local": "python:local-mine-compare",
    "aicu:scrape": "python:aicu-compare",
    "aicu:batch": "python:aicu-batch-compare",
    "uid:discovery": "python:uid-discovery-compare",
    "uid:range": "python:uid-range-scrape-compare",
}

DEFAULT_PACKAGE_VALIDATION_SCOPES = {
    "python:deepseek-cli-compare": "dry_run_plan",
    "python:deepseek-cli-plan-js": "dry_run_plan_argv_stdin_file_help_multiagent_fixtures_and_js_python_bridge",
    "python:deepseek-validation-compare": "analysis_validation",
    "python:deepseek-normalization-compare": "analysis_normalization",
    "python:deepseek-analyze-fixture-compare": "full_command_fixture",
    "python:deepseek-analyze-command-compare": "full_command_python_runtime_mock_multiagent_env_bridge_and_live_gate_contract",
    "python:deepseek-mock-runtime-compare": "mocked_runtime",
    "python:keyword-evidence-compare": "entries_dictionary_filtered_empty_evidence_fixtures_and_js_python_bridge",
    "python:harvest-plan-compare": "dry_run_plan_fixture_and_js_python_plan_bridge",
    "python:harvest-state-compare": "file_backed_default_miss_successful_hit_corrupt_payload_fixtures_and_js_python_bridge",
    "python:file-lock-state-compare": "file_backed_stale_missing_corrupt_owner_fixtures_and_js_python_bridge",
    "python:dictionary-prune-compare": "summary_command_fixture",
    "python:flatten-local-compare": "uid_map_top_level_tieba_runs_user_history_fixtures_and_js_python_bridge",
    "python:local-evidence-compare": "target_term_weak_term_ranking_source_backfill_flattened_payload_fixtures_and_js_python_bridge",
    "python:exhausted-prune-compare": "dry_run_plan_fixture",
    "python:near-target-compare": "dry_run_plan_fixture",
    "python:coverage-cli-options-compare": "coverage_runtime_default_env_fallback_strict_source_backed_fixtures_and_js_python_bridge",
    "python:coverage-loop-compare": "dry_run_plan_no_live_mock_cycle_no_progress_multi_cycle_mock_write_file_backed_mock_harvest_js_python_command_and_deferred_live_contract",
    "python:coverage-loop-command-compare": "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_external_options_js_adapter_live_bridge_commands_deferred_live_contract",
    "python:coverage-progress-compare": "payload_default_action_progress_corrupt_payload_fixtures_and_js_python_bridge",
    "python:harvest-options-compare": "video_keyword_default_priority_query_content_expanded_template_fixtures_and_js_python_bridge",
    "python:discovery-report-compare": "report_fixture_rich_discovery_fixture_and_js_python_bridge",
    "python:tieba-keyword-compare": "dry_run_plan_fixture_scrape_fixture_and_js_python_plan_bridge",
    "python:video-link-direct-compare": "dry_run_plan_video_favorite_uid_missing_target_fixtures_and_js_python_bridge",
    "python:direct-probe-compare": "dry_run_plan_and_no_live_command_fixture",
    "python:direct-probe-command-compare": "full_command_query_aid_danmaku_write_fixture_matrix",
    "python:aicu-compare": "dry_run_plan_inline_missing_file_page_override_fixtures_and_js_python_bridge",
    "python:aicu-batch-compare": "dry_run_plan_resume_empty_range_malformed_payload_fixtures_and_js_python_bridge",
    "python:aicu-browser-compare": "dry_run_default_fresh_completed_range_fixtures_and_js_python_plan_bridge",
    "python:batch-bilibili-compare": "dry_run_plan_resume_empty_parseint_prefix_fixtures_and_js_python_bridge",
    "python:batch-popular-compare": "dry_run_plan_resume_empty_parseint_prefix_fixtures_and_js_python_bridge",
    "python:batch-scraper-launcher-compare": "dry_run_plan_default_custom_data_dir_fixtures_and_js_python_bridge",
    "python:batch-uid-scrape-compare": "dry_run_plan_populated_empty_malformed_stats_fixtures_and_js_python_bridge",
    "python:batch-uid-range-compare": "dry_run_plan_phase2_default_decimal_malformed_stats_fixtures_and_js_python_bridge",
    "python:batch-scrape-progress-compare": "file_backed_uid_range_popular_corrupt_inputs_fixtures_and_js_python_bridge",
    "python:batch-uid-progress-compare": "file_backed_default_parseint_stats_prefix_corrupt_input_fixtures_and_js_python_bridge",
    "python:fast-pipeline-launcher-compare": "dry_run_plan_default_custom_data_dir_fixtures_and_js_python_bridge",
    "python:range-scraper-launcher-compare": "dry_run_plan_default_custom_data_dir_fixtures_and_js_python_bridge",
    "python:uid-discovery-compare": "dry_run_plan_analysis_resume_discovery_start_malformed_numeric_fixtures_and_js_python_bridge",
    "python:uid-fast-pipeline-compare": "dry_run_plan_default_range_parseint_prefix_fixtures_and_js_python_bridge",
    "python:uid-fast-worker-compare": "dry_run_plan_default_worker_number_fallback_parseint_uids_fixtures_and_js_python_bridge",
    "python:uid-parallel-compare": "dry_run_plan_default_worker_parseint_prefix_fixtures_and_js_python_bridge",
    "python:uid-parallel-progress-compare": "file_backed_default_corrupt_inputs_fixtures_and_js_python_bridge",
    "python:uid-pipeline-launcher-compare": "dry_run_plan_default_custom_data_dir_fixtures_and_js_python_bridge",
    "python:uid-pipeline-progress-compare": "file_backed_default_parseint_uid_prefix_corrupt_inputs_fixtures_and_js_python_bridge",
    "python:uid-pipeline-state-compare": "file_backed_default_parseint_worker_prefix_corrupt_progress_fixtures_and_js_python_bridge",
    "python:uid-pipeline-worker-compare": "dry_run_plan_default_range_parseint_prefix_fixtures_and_js_python_bridge",
    "python:uid-range-scrape-compare": "dry_run_plan_custom_progress_default_range_malformed_stats_fixtures_and_js_python_bridge",
    "python:uid-range-progress-compare": "file_backed_default_parseint_stats_prefix_corrupt_input_fixtures_and_js_python_bridge",
    "python:uid-discovery-progress-compare": "file_backed_default_parseint_stats_prefix_corrupt_inputs_fixtures_and_js_python_bridge",
    "python:scraper-monitor-compare": "file_backed_default_parseint_stats_prefix_corrupt_progress_fixtures_and_js_python_bridge",
    "python:tieba-html-parse-compare": "threads_comments_discovery_fixtures_and_js_python_bridge",
    "python:tieba-corpus-compare": "merge_new_comments_unchanged_empty_run_dedupe_cap_runs_fixtures_and_js_python_bridge",
    "python:tieba-timing-compare": "default_zero_query_string_negative_coercion_fixtures_and_js_python_bridge",
    "python:direct-probe-update-compare": "dedupe_empty_existing_multi_video_run_fixtures_and_js_python_bridge",
    "python:huggingface-compare": "full_command",
    "python:local-mine-compare": "full_command",
    "python:bilibili-parse-compare": "danmaku_xml_extract_bvid_bvid_pool_fixtures_and_js_python_bridge",
}

DEFAULT_PACKAGE_REPLACEMENT_SCOPES = {
    "dictionary:prune": "summary_only",
    "dictionary:prune-exhausted": "dry_run_plan",
    "dictionary:resolve-near": "dry_run_plan",
    "dictionary:auto": "dry_run_plan",
    "dictionary:tieba": "dry_run_plan",
    "deepseek:analyze": "live_api_runtime",
    "aicu:scrape": "dry_run_plan",
    "aicu:batch": "dry_run_plan",
    "uid:discovery": "dry_run_plan",
    "uid:range": "dry_run_plan",
}

DEFAULT_RETAINED_NODE_COMMANDS = {
    "server": "app_api_orchestration",
    "dev:full": "app_api_orchestration",
    "aicu:test": "external_api_smoke_test",
    "dictionary:probe-bilibili:js": "legacy_compatibility_after_python_replacement",
}

DEFAULT_BRIDGE_NODE_COMMANDS = {
    "python:deepseek-cli-compare": "js_python_contract_bridge",
    "python:deepseek-cli-plan-js": "js_python_contract_bridge",
    "python:deepseek-validation-compare": "js_python_contract_bridge",
    "python:deepseek-normalization-compare": "js_python_contract_bridge",
    "python:deepseek-analyze-fixture-compare": "js_python_contract_bridge",
    "python:deepseek-analyze-command-compare": "js_python_contract_bridge",
    "python:deepseek-mock-runtime-compare": "js_python_contract_bridge",
    "python:keyword-evidence-compare": "js_python_contract_bridge",
    "python:harvest-plan-compare": "js_python_contract_bridge",
    "python:harvest-state-compare": "js_python_contract_bridge",
    "python:file-lock-state-compare": "js_python_contract_bridge",
    "python:dictionary-prune-compare": "js_python_contract_bridge",
    "python:flatten-local-compare": "js_python_contract_bridge",
    "python:local-evidence-compare": "js_python_contract_bridge",
    "python:exhausted-prune-compare": "js_python_contract_bridge",
    "python:near-target-compare": "js_python_contract_bridge",
    "python:coverage-loop-compare": "js_python_contract_bridge",
    "python:coverage-loop-command-compare": "js_python_contract_bridge",
    "python:coverage-cli-options-compare": "js_python_contract_bridge",
    "python:coverage-progress-compare": "js_python_contract_bridge",
    "python:discovery-report-compare": "js_python_contract_bridge",
    "python:video-link-direct-compare": "js_python_contract_bridge",
    "python:harvest-options-compare": "js_python_contract_bridge",
    "python:tieba-keyword-compare": "js_python_contract_bridge",
    "python:tieba-html-parse-compare": "js_python_contract_bridge",
    "python:tieba-corpus-compare": "js_python_contract_bridge",
    "python:tieba-timing-compare": "js_python_contract_bridge",
    "python:direct-probe-compare": "js_python_contract_bridge",
    "python:direct-probe-command-compare": "js_python_contract_bridge",
    "python:direct-probe-update-compare": "js_python_contract_bridge",
    "python:aicu-compare": "js_python_contract_bridge",
    "python:aicu-batch-compare": "js_python_contract_bridge",
    "python:aicu-browser-compare": "js_python_contract_bridge",
    "python:batch-bilibili-compare": "js_python_contract_bridge",
    "python:batch-popular-compare": "js_python_contract_bridge",
    "python:batch-uid-scrape-compare": "js_python_contract_bridge",
    "python:batch-uid-range-compare": "js_python_contract_bridge",
    "python:uid-discovery-compare": "js_python_contract_bridge",
    "python:uid-range-scrape-compare": "js_python_contract_bridge",
    "python:batch-scraper-launcher-compare": "js_python_contract_bridge",
    "python:range-scraper-launcher-compare": "js_python_contract_bridge",
    "python:uid-pipeline-launcher-compare": "js_python_contract_bridge",
    "python:fast-pipeline-launcher-compare": "js_python_contract_bridge",
    "python:uid-fast-pipeline-compare": "js_python_contract_bridge",
    "python:uid-fast-worker-compare": "js_python_contract_bridge",
    "python:uid-pipeline-worker-compare": "js_python_contract_bridge",
    "python:uid-parallel-compare": "js_python_contract_bridge",
    "python:uid-parallel-progress-compare": "js_python_contract_bridge",
    "python:uid-pipeline-progress-compare": "js_python_contract_bridge",
    "python:uid-pipeline-state-compare": "js_python_contract_bridge",
    "python:scraper-monitor-compare": "js_python_contract_bridge",
    "python:uid-discovery-progress-compare": "js_python_contract_bridge",
    "python:batch-scrape-progress-compare": "js_python_contract_bridge",
    "python:batch-uid-progress-compare": "js_python_contract_bridge",
    "python:uid-range-progress-compare": "js_python_contract_bridge",
    "python:local-mine-compare": "js_python_contract_bridge",
    "python:bilibili-parse-compare": "js_python_contract_bridge",
}

PYTHON_OWNED_DATA_PIPELINE_COMMANDS = {
    "coverage_audit": ("python_backend.cli.coverage_audit",),
    "dictionary_prune": ("python_backend.cli.dictionary_prune_summary",),
    "exhausted_terms_prune": ("python_backend.cli.exhausted_terms_prune_plan",),
    "near_target_resolve": ("python_backend.cli.near_target_resolve_plan",),
    "random_verification": ("python_backend.cli.random_verification",),
    "contract_comparison": ("python_backend.cli.compare_contracts",),
    "analyzer_validation": ("python_backend.cli.deepseek_analyze --live-validation-gate",),
    "keyword_evidence": ("python_backend.cli.keyword_evidence",),
    "direct_probe_corpus": ("python_backend.cli.direct_probe_corpus",),
    "direct_probe_command": ("python_backend.cli.direct_probe_command",),
    "direct_probe_live_fetch": ("python_backend.cli.direct_probe_live_fetch",),
    "uid_pipeline_merge": ("python_backend.cli.uid_pipeline_merge",),
    "agent_dictionary_merge": ("python_backend.cli.merge_agent_dictionaries_plan --write",),
    "scraper_monitor": ("python_backend.cli.scraper_monitor",),
    "coverage_progress": ("python_backend.cli.coverage_progress",),
    "coverage_loop_command": ("python_backend.cli.coverage_loop_command",),
    "discovery_report": ("python_backend.cli.discovery_report",),
    "harvest_options": ("python_backend.cli.harvest_options",),
    "harvest_state": ("python_backend.cli.harvest_state",),
    "file_lock_state": ("python_backend.cli.file_lock_state",),
    "corpus_shard_writer": ("python_backend.cli.corpus_shard_writer",),
    "huggingface_corpus": ("python_backend.cli.huggingface_corpus",),
    "tieba_html_parse": ("python_backend.cli.tieba_html_parse",),
    "tieba_corpus_update": ("python_backend.cli.tieba_corpus",),
    "tieba_timing": ("python_backend.cli.tieba_timing",),
    "local_corpus_mine": ("python_backend.cli.local_corpus_mine",),
    "local_corpus_flatten": ("python_backend.cli.local_corpus_flatten",),
    "local_corpus_evidence": ("python_backend.cli.local_corpus_evidence",),
    "semantic_matcher": ("python_backend.cli.semantic_matcher",),
    "comment_coverage": ("python_backend.cli.comment_coverage",),
    "history_tag_corpus": ("python_backend.cli.history_tag_corpus",),
    "aicu_browser_batch_plan": ("python_backend.cli.aicu_browser_batch_plan",),
    "batch_bilibili_plan": ("python_backend.cli.batch_bilibili_plan",),
    "batch_popular_plan": ("python_backend.cli.batch_popular_plan",),
    "batch_uid_scrape_plan": ("python_backend.cli.batch_uid_scrape_plan",),
    "batch_uid_range_plan": ("python_backend.cli.batch_uid_range_plan",),
    "uid_discovery_plan": ("python_backend.cli.uid_discovery_plan",),
    "uid_range_scrape_plan": ("python_backend.cli.uid_range_scrape_plan",),
    "batch_scraper_launcher": ("python_backend.cli.batch_scraper_launcher",),
    "range_scraper_launcher": ("python_backend.cli.range_scraper_launcher",),
    "uid_pipeline_launcher": ("python_backend.cli.uid_pipeline_launcher",),
    "fast_pipeline_launcher": ("python_backend.cli.fast_pipeline_launcher",),
    "uid_fast_pipeline_plan": ("python_backend.cli.uid_fast_pipeline_plan",),
    "uid_fast_pipeline_worker_plan": ("python_backend.cli.uid_fast_pipeline_worker_plan",),
    "uid_pipeline_worker_plan": ("python_backend.cli.uid_pipeline_plan",),
    "uid_parallel_analyzer_plan": ("python_backend.cli.uid_parallel_plan",),
    "uid_parallel_progress": ("python_backend.cli.uid_parallel_progress",),
    "uid_pipeline_progress": ("python_backend.cli.uid_pipeline_progress",),
    "uid_pipeline_state": ("python_backend.cli.uid_pipeline_state",),
    "uid_discovery_progress": ("python_backend.cli.uid_discovery_progress",),
    "batch_scrape_progress": ("python_backend.cli.batch_scrape_progress",),
    "batch_uid_progress": ("python_backend.cli.batch_uid_progress",),
    "uid_range_progress": ("python_backend.cli.uid_range_progress",),
}

RETAINED_JS_FILE_PREFIXES = {
    "server/routes/": "app_api_orchestration",
}

RETAINED_JS_FILES = {
    "server/index.js": "app_api_orchestration",
    "server/utils/paths.js": "shared_runtime_support",
    "server/utils/fileLock.js": "shared_runtime_support",
    "server/scripts/compareDeepSeekAnalyzePlan.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalysisValidation.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalysisNormalization.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalyzeFixture.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalyzeCommand.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalyzeMockRuntime.js": "js_python_contract_bridge",
    "server/scripts/compareKeywordEvidence.js": "js_python_contract_bridge",
    "server/scripts/compareHarvestPlan.js": "js_python_contract_bridge",
    "server/scripts/compareHarvestState.js": "js_python_contract_bridge",
    "server/scripts/compareFileLockState.js": "js_python_contract_bridge",
    "server/scripts/compareDictionaryPruneSummary.js": "js_python_contract_bridge",
    "server/scripts/compareLocalCorpusFlatten.js": "js_python_contract_bridge",
    "server/scripts/compareLocalCorpusEvidence.js": "js_python_contract_bridge",
    "server/scripts/compareExhaustedTermsPrunePlan.js": "js_python_contract_bridge",
    "server/scripts/compareLocalCorpusMine.js": "js_python_contract_bridge",
    "server/scripts/compareNearTargetResolvePlan.js": "js_python_contract_bridge",
    "server/scripts/compareCoverageHarvestLoopPlan.js": "js_python_contract_bridge",
    "server/scripts/compareCoverageHarvestLoopCommand.js": "js_python_contract_bridge",
    "server/scripts/runCoverageHarvestLoopJsAdapter.js": "js_python_contract_bridge",
    "server/scripts/compareCoverageCliOptions.js": "js_python_contract_bridge",
    "server/scripts/compareCoverageProgress.js": "js_python_contract_bridge",
    "server/scripts/compareVideoKeywordDiscoveryReport.js": "js_python_contract_bridge",
    "server/scripts/compareVideoLinkDirectPlan.js": "js_python_contract_bridge",
    "server/scripts/compareHarvestOptions.js": "js_python_contract_bridge",
    "server/scripts/compareTiebaKeywordPlan.js": "js_python_contract_bridge",
    "server/scripts/compareTiebaHtmlParse.js": "js_python_contract_bridge",
    "server/scripts/compareTiebaCorpusUpdate.js": "js_python_contract_bridge",
    "server/scripts/compareTiebaTiming.js": "js_python_contract_bridge",
    "server/scripts/compareDirectProbePlan.js": "js_python_contract_bridge",
    "server/scripts/compareDirectProbeCommand.js": "js_python_contract_bridge",
    "server/scripts/compareDirectProbeCorpus.js": "js_python_contract_bridge",
    "server/scripts/compareAicuScrapePlan.js": "js_python_contract_bridge",
    "server/scripts/compareAicuBatchPlan.js": "js_python_contract_bridge",
    "server/scripts/compareAicuBrowserBatchPlan.js": "js_python_contract_bridge",
    "server/scripts/compareBatchBilibiliPlan.js": "js_python_contract_bridge",
    "server/scripts/compareBatchPopularPlan.js": "js_python_contract_bridge",
    "server/scripts/compareBatchUidScrapePlan.js": "js_python_contract_bridge",
    "server/scripts/compareBatchUidRangePlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidDiscoveryPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidRangeScrapePlan.js": "js_python_contract_bridge",
    "server/scripts/compareBatchScraperLauncherPlan.js": "js_python_contract_bridge",
    "server/scripts/compareRangeScraperLauncherPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidPipelineLauncherPlan.js": "js_python_contract_bridge",
    "server/scripts/compareFastPipelineLauncherPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidFastPipelinePlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidFastPipelineWorkerPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidPipelineWorkerPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidParallelPlan.js": "js_python_contract_bridge",
    "server/scripts/compareUidParallelProgress.js": "js_python_contract_bridge",
    "server/scripts/compareUidPipelineProgress.js": "js_python_contract_bridge",
    "server/scripts/compareUidPipelineState.js": "js_python_contract_bridge",
    "server/scripts/compareScraperMonitor.js": "js_python_contract_bridge",
    "server/scripts/compareUidDiscoveryProgress.js": "js_python_contract_bridge",
    "server/scripts/compareBatchScrapeProgress.js": "js_python_contract_bridge",
    "server/scripts/compareBatchUidProgress.js": "js_python_contract_bridge",
    "server/scripts/compareUidRangeProgress.js": "js_python_contract_bridge",
    "server/scripts/compareBilibiliParse.js": "js_python_contract_bridge",
}

MIGRATION_PRIORITY_RULES = (
    ("corpus_analysis_pipeline", 10, ("Corpus", "Dictionary", "Coverage", "DeepSeek", "Semantic", "Evidence", "Stats", "HuggingFace", "Tieba", "HistoryTags", "Readme")),
    ("scraper_pipeline", 20, ("Scrape", "Scraper", "Crawler", "Probe", "Uid", "Video", "Aicu", "Bilibili")),
    ("runtime_support", 30, ("Options", "Progress", "Report", "Monitor", "Lock")),
)


@dataclass(frozen=True)
class BackendMigrationInventoryScanner:
    """Count remaining JS backend files that still need Python migration coverage."""

    root: str | Path = "."

    def scan(self) -> dict[str, Any]:
        root = Path(self.root)
        package_inventory = PackageCommandMigrationInventory.from_root(root)
        package_scripts_raw = package_inventory.package.get("scripts") if isinstance(package_inventory.package.get("scripts"), dict) else {}
        backend_files: dict[str, list[str]] = {key: [] for key in (*BACKEND_CATEGORY_PREFIXES.keys(), "root")}
        migration_candidate_files: dict[str, list[str]] = {key: [] for key in (*BACKEND_CATEGORY_PREFIXES.keys(), "root")}
        retained_files: list[dict[str, str]] = []
        backend_tests: list[str] = []

        for path in sorted((root / "server").rglob("*.js")) if (root / "server").exists() else []:
            relative = path.relative_to(root).as_posix()
            if relative.endswith(".test.js"):
                backend_tests.append(relative)
                continue
            category = self._category(relative)
            if category:
                backend_files[category].append(relative)
                retained_reason = self._retained_reason(relative, package_scripts_raw)
                if retained_reason:
                    retained_files.append({"path": relative, "reason": retained_reason})
                else:
                    migration_candidate_files[category].append(relative)

        categories = {key: len(value) for key, value in backend_files.items()}
        migration_candidate_categories = {key: len(value) for key, value in migration_candidate_files.items()}
        migration_priority_files = self._priority_files(migration_candidate_files)
        package_scripts = package_inventory.scan()
        next_migration_action = self._next_migration_action(migration_priority_files, package_scripts)
        next_offline_migration_action = self._next_migration_action(
            migration_priority_files,
            package_scripts,
            skip_replacement_scopes=("live_api_runtime",),
            offline_reason="skips_live_api_runtime",
        )
        return {
            "ok": True,
            "root": str(root),
            "remainingJsBackendFiles": sum(categories.values()),
            "migrationCandidateJsBackendFiles": sum(migration_candidate_categories.values()),
            "backendJsTests": len(backend_tests),
            "categories": categories,
            "files": backend_files,
            "migrationCandidateCategories": migration_candidate_categories,
            "migrationCandidateFiles": migration_candidate_files,
            "migrationPriorityFiles": migration_priority_files,
            "nextMigrationAction": next_migration_action,
            "nextOfflineMigrationAction": next_offline_migration_action,
            "retainedJsBackendFiles": retained_files,
            "testFiles": backend_tests,
            "packageScripts": package_scripts,
        }

    @staticmethod
    def _category(relative_path: str) -> str:
        if relative_path == "server/index.js":
            return "root"
        for category, prefix in BACKEND_CATEGORY_PREFIXES.items():
            if relative_path.startswith(prefix):
                return category
        return ""

    @staticmethod
    def _retained_reason(relative_path: str, package_scripts: dict[str, Any] | None = None) -> str:
        package_scripts = package_scripts if isinstance(package_scripts, dict) else {}
        if (
            relative_path == "server/scripts/importHuggingFaceCorpus.js"
            and package_scripts.get("dictionary:huggingface") == "python -m python_backend.cli.huggingface_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/updateReadmeStatsGraph.js"
            and package_scripts.get("stats:update") == "python -m python_backend.cli.readme_stats"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/runDictionaryCoverageAudit.js"
            and str(package_scripts.get("dictionary:coverage") or "").startswith("python -m python_backend.cli.coverage_audit --standalone")
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/pruneKeywordDictionary.js"
            and str(package_scripts.get("dictionary:prune") or "").startswith("python -m python_backend.cli.dictionary_prune_summary --write")
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/pruneExhaustedTerms.js"
            and package_scripts.get("dictionary:prune-exhausted") == "python -m python_backend.cli.exhausted_terms_prune_plan"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/resolveNearTargetTerms.js"
            and package_scripts.get("dictionary:resolve-near") == "python -m python_backend.cli.near_target_resolve_plan"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/scrapeBilibiliHistoryTags.js"
            and package_scripts.get("dictionary:history-tags") == "python -m python_backend.cli.history_tag_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/bilibiliHistoryTags.js"
            and package_scripts.get("dictionary:history-tags") == "python -m python_backend.cli.history_tag_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/mineLocalCorpusEvidence.js"
            and package_scripts.get("dictionary:mine-local") == "python -m python_backend.cli.local_corpus_mine"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/localCorpusEvidence.js"
            and package_scripts.get("dictionary:mine-local") == "python -m python_backend.cli.local_corpus_mine"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/semanticMatcher.js"
            and package_scripts.get("python:semantic-match") == "python -m python_backend.cli.semantic_matcher"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/commentCoverage.js"
            and package_scripts.get("python:comment-coverage") == "python -m python_backend.cli.comment_coverage"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/probeBilibiliCommentEvidence.js"
            and package_scripts.get("dictionary:probe-bilibili") == "python -m python_backend.cli.direct_probe_command"
            and package_scripts.get("dictionary:probe-bilibili:js") == "node server/scripts/probeBilibiliCommentEvidence.js"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/directBilibiliEvidenceProbe.js"
            and package_scripts.get("python:direct-probe-command") == "python -m python_backend.cli.direct_probe_command"
            and package_scripts.get("python:direct-probe-update") == "python -m python_backend.cli.direct_probe_corpus"
            and package_scripts.get("python:direct-probe-live-fetch") == "python -m python_backend.cli.direct_probe_live_fetch"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/mergeUidPipelineResults.js"
            and str(package_scripts.get("python:uid-pipeline-merge") or "").startswith("python -m python_backend.cli.uid_pipeline_merge")
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/mergeAgentDictionaries.js"
            and package_scripts.get("python:merge-agent") == "python -m python_backend.cli.merge_agent_dictionaries_plan --write"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/monitorScrapers.js"
            and package_scripts.get("python:scraper-monitor") == "python -m python_backend.cli.scraper_monitor"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/testAicuApi.js"
            and package_scripts.get("aicu:test") == "node server/scripts/testAicuApi.js"
        ):
            return "external_api_smoke_test"
        if (
            relative_path == "server/utils/coverageProgress.js"
            and package_scripts.get("python:coverage-progress") == "python -m python_backend.cli.coverage_progress"
            and package_scripts.get("python:coverage-progress-compare") == "node server/scripts/compareCoverageProgress.js"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/utils/runVideoKeywordDiscoveryReport.js"
            and package_scripts.get("python:discovery-report") == "python -m python_backend.cli.discovery_report"
            and package_scripts.get("python:discovery-report-compare") == "node server/scripts/compareVideoKeywordDiscoveryReport.js"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/utils/runVideoKeywordDiscoveryOptions.js"
            and package_scripts.get("python:harvest-options") == "python -m python_backend.cli.harvest_options"
            and package_scripts.get("python:harvest-options-compare") == "node server/scripts/compareHarvestOptions.js"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/utils/coverageCliOptions.js"
            and package_scripts.get("python:harvest-options") == "python -m python_backend.cli.harvest_options"
            and package_scripts.get("python:coverage-cli-options-compare") == "node server/scripts/compareCoverageCliOptions.js"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/splitCorpusStorage.js"
            and package_scripts.get("python:corpus-write") == "python -m python_backend.cli.corpus_shard_writer"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/huggingFaceCorpus.js"
            and package_scripts.get("dictionary:huggingface") == "python -m python_backend.cli.huggingface_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/tiebaCorpus.js"
            and package_scripts.get("python:tieba-update") == "python -m python_backend.cli.tieba_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/services/tiebaScrapeTiming.js"
            and package_scripts.get("python:tieba-timing") == "python -m python_backend.cli.tieba_timing"
        ):
            return "legacy_compatibility_after_python_replacement"
        if relative_path in RETAINED_JS_FILES:
            return RETAINED_JS_FILES[relative_path]
        for prefix, reason in RETAINED_JS_FILE_PREFIXES.items():
            if relative_path.startswith(prefix):
                return reason
        return ""

    @classmethod
    def _priority_files(cls, migration_candidate_files: dict[str, list[str]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for category, paths in migration_candidate_files.items():
            for path in paths:
                group, priority = cls._priority_for(path)
                items.append({"path": path, "category": category, "priority": priority, "group": group})
        return sorted(items, key=lambda item: (item["priority"], item["category"], item["path"]))

    @staticmethod
    def _priority_for(relative_path: str) -> tuple[str, int]:
        stem = Path(relative_path).stem
        compact = stem[:1].upper() + stem[1:]
        for group, priority, needles in MIGRATION_PRIORITY_RULES:
            if any(needle in compact for needle in needles):
                return group, priority
        return "uncategorized_pipeline", 40

    @staticmethod
    def _next_migration_action(
        priority_files: list[dict[str, Any]],
        package_scripts: dict[str, Any],
        *,
        skip_replacement_scopes: tuple[str, ...] = (),
        offline_reason: str = "",
    ) -> dict[str, Any]:
        if not priority_files:
            return {}
        for priority_file in priority_files:
            first = dict(priority_file)
            for mapping in package_scripts.get("pythonBackedNodeScripts", []):
                if not isinstance(mapping, dict):
                    continue
                command = str(mapping.get("command") or "")
                replacement_scope = str(mapping.get("replacementScope") or "")
                if first["path"] in command and replacement_scope in skip_replacement_scopes:
                    break
                if first["path"] in command:
                    validation_script = str(mapping.get("validationScript") or "")
                    validation_command = str(mapping.get("validationCommand") or "")
                    validation_scope = str(mapping.get("validationScope") or "")
                    ready_to_replace = bool(validation_script and validation_command and validation_scope == "full_command")
                    replacement_blockers = BackendMigrationInventoryScanner._replacement_blockers(
                        script=str(mapping.get("script") or ""),
                        validation_scope=validation_scope,
                        ready_to_replace=ready_to_replace,
                    )
                    validation_gates = BackendMigrationInventoryScanner._validation_gates(
                        validation_script=validation_script,
                        validation_scope=validation_scope,
                    )
                    action = {
                        **first,
                        "nodeScript": str(mapping.get("script") or ""),
                        "nodeCommand": command,
                        "pythonScript": str(mapping.get("pythonScript") or ""),
                        "pythonCommand": str(mapping.get("pythonCommand") or ""),
                        "validationScript": validation_script,
                        "validationCommand": validation_command,
                        "validationScope": validation_scope,
                        "readyToReplace": ready_to_replace,
                        "recommendation": "compare_python_contract_before_replacing_js" if ready_to_replace else "expand_python_runtime_contract_before_replacing_js",
                    }
                    if offline_reason:
                        action["offlineReason"] = offline_reason
                    if validation_gates:
                        action["validationGates"] = validation_gates
                    if replacement_blockers:
                        action["replacementBlockers"] = replacement_blockers
                    return action
            else:
                if skip_replacement_scopes:
                    return {
                        **first,
                        "nodeScript": "",
                        "nodeCommand": "",
                        "pythonScript": "",
                        "pythonCommand": "",
                        "validationScript": "",
                        "validationCommand": "",
                        "validationScope": "",
                        "readyToReplace": False,
                        "offlineReason": offline_reason,
                        "replacementBlockers": [{"blocker": "missing_python_contract", "reason": "No Python compatibility command is linked to this JS backend file."}],
                        "recommendation": "create_python_contract_then_compare_js",
                    }
                break
        first = dict(priority_files[0])
        for mapping in package_scripts.get("pythonBackedNodeScripts", []):
            if not isinstance(mapping, dict):
                continue
            command = str(mapping.get("command") or "")
            if first["path"] in command:
                validation_script = str(mapping.get("validationScript") or "")
                validation_command = str(mapping.get("validationCommand") or "")
                validation_scope = str(mapping.get("validationScope") or "")
                ready_to_replace = bool(validation_script and validation_command and validation_scope == "full_command")
                replacement_blockers = BackendMigrationInventoryScanner._replacement_blockers(
                    script=str(mapping.get("script") or ""),
                    validation_scope=validation_scope,
                    ready_to_replace=ready_to_replace,
                )
                validation_gates = BackendMigrationInventoryScanner._validation_gates(
                    validation_script=validation_script,
                    validation_scope=validation_scope,
                )
                action = {
                    **first,
                    "nodeScript": str(mapping.get("script") or ""),
                    "nodeCommand": command,
                    "pythonScript": str(mapping.get("pythonScript") or ""),
                    "pythonCommand": str(mapping.get("pythonCommand") or ""),
                    "validationScript": validation_script,
                    "validationCommand": validation_command,
                    "validationScope": validation_scope,
                    "readyToReplace": ready_to_replace,
                    "recommendation": "compare_python_contract_before_replacing_js" if ready_to_replace else "expand_python_runtime_contract_before_replacing_js",
                }
                if validation_gates:
                    action["validationGates"] = validation_gates
                if replacement_blockers:
                    action["replacementBlockers"] = replacement_blockers
                return action
        return {
            **first,
            "nodeScript": "",
            "nodeCommand": "",
            "pythonScript": "",
            "pythonCommand": "",
            "validationScript": "",
            "validationCommand": "",
            "validationScope": "",
            "readyToReplace": False,
            "replacementBlockers": [{"blocker": "missing_python_contract", "reason": "No Python compatibility command is linked to this JS backend file."}],
            "recommendation": "create_python_contract_then_compare_js",
        }

    @staticmethod
    def _replacement_blockers(*, script: str, validation_scope: str, ready_to_replace: bool) -> list[dict[str, str]]:
        if ready_to_replace:
            return []
        blockers: list[dict[str, str]] = []
        if script == "dictionary:probe-bilibili" and validation_scope == "dry_run_plan_and_no_live_command_fixture":
            blockers.append(
                {
                    "blocker": "live_bilibili_command_runtime_not_integrated",
                    "reason": "Python has fixture-covered probe-loop orchestration, a unit-tested live reply/danmaku fetch adapter, an opt-in JS command bridge, an opt-in JS Python command runtime payload bridge, and an opt-in JS live-fetch bridge, but dictionary:probe-bilibili still defaults to the JS live orchestration path.",
                }
            )
        elif script == "deepseek:analyze" and validation_scope == "full_command_python_runtime_mock_multiagent_env_bridge_and_live_gate_contract":
            blockers.append(
                {
                    "blocker": "credentialed_live_api_command_not_verified",
                    "reason": "Validation covers Python runtime mocks, multiagent mocks, and the offline live-gate skip contract, but no credentialed live API command run has been verified.",
                }
            )
        elif script == "dictionary:auto" and validation_scope in {
            "dry_run_plan_no_live_mock_cycle_no_progress_multi_cycle_mock_write_file_backed_mock_harvest_js_python_command_and_deferred_live_contract",
            "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_and_deferred_live_contract",
            "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_external_command_and_deferred_live_contract",
            "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_external_and_js_adapter_commands_deferred_live_contract",
            "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_external_options_js_adapter_commands_deferred_live_contract",
            "no_live_mock_cycle_no_progress_multi_cycle_report_write_file_backed_mock_harvest_external_options_js_adapter_live_bridge_commands_deferred_live_contract",
        }:
            blockers.append(
                {
                    "blocker": "coverage_loop_live_runtime_not_verified",
                    "reason": "Python has dry-run, no-live, mock cycle, mock harvest, file-backed mock harvest, external harvest adapter, checked-in JS harvest adapter command, and deferred live contracts, but dictionary:auto still needs a verified live Bilibili/Tieba harvest runtime before replacing the JS loop.",
                }
            )
        elif validation_scope != "full_command":
            blockers.append(
                {
                    "blocker": "validation_scope_not_full_command",
                    "reason": "Validation covers Python runtime mocks and multiagent mocks, but not a full live command replacement gate.",
                }
            )
        return blockers

    @staticmethod
    def _validation_gates(*, validation_script: str, validation_scope: str) -> list[dict[str, str]]:
        if validation_script == "python:deepseek-analyze-command-compare":
            return [
                {"gate": "fixture_command", "status": "covered", "source": "compareDeepSeekAnalyzeCommandSuite"},
                {"gate": "mock_runtime_command", "status": "covered", "source": "compareDeepSeekAnalyzeCommandSuite"},
                {"gate": "multiagent_mock_runtime", "status": "covered", "source": "compareDeepSeekAnalyzeCommandSuite"},
                {"gate": "js_env_python_runtime_bridge", "status": "covered", "source": "compareDeepSeekAnalyzeCommandSuite"},
                {"gate": "live_api_command", "status": "covered_offline_skip_contract", "source": "compareDeepSeekAnalyzeCommandSuite"},
                {"gate": "legacy_selector_compatibility", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
            ]
        if validation_script in {"python:direct-probe-compare", "python:direct-probe-command-compare"}:
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:direct-probe-compare"},
                {"gate": "corpus_update_js_runner_fixture", "status": "covered", "source": "python:direct-probe-update-compare"},
                {"gate": "python_live_fetch_unit", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "python_probe_loop_fixture", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "command_js_python_fixture", "status": "covered", "source": "python:direct-probe-command-compare"},
                {"gate": "command_explicit_aid_fixture", "status": "covered", "source": "compareDirectProbeCommand.test.js"},
                {"gate": "command_explicit_aid_danmaku_fixture", "status": "covered", "source": "compareDirectProbeCommand.test.js"},
                {"gate": "command_write_mode_fixture", "status": "covered", "source": "compareDirectProbeCommand.test.js"},
                {"gate": "command_full_python_runtime_fixture", "status": "covered", "source": "compareDirectProbeCommand.test.js"},
                {"gate": "js_opt_in_python_command_bridge", "status": "covered", "source": "probeBilibiliCommentEvidence.test.js"},
                {"gate": "js_opt_in_python_command_runtime", "status": "covered", "source": "probeBilibiliCommentEvidence.test.js"},
                {"gate": "js_python_command_runtime_options", "status": "covered", "source": "probeBilibiliCommentEvidence.test.js"},
                {"gate": "python_normal_cli_file_runtime", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "python_normal_cli_write_persistence", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "js_opt_in_python_live_fetch_bridge", "status": "covered", "source": "probeBilibiliCommentEvidence.test.js"},
            ]
        if validation_script == "python:dictionary-prune-compare":
            return [
                {"gate": "summary_command_fixture", "status": "covered", "source": "python:dictionary-prune-compare"},
                {"gate": "python_write_mode_split_dictionary", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "js_python_write_mode_persisted_terms", "status": "covered", "source": "compareDictionaryPruneSummary.test.js"},
            ]
        if validation_script in {"python:coverage-loop-compare", "python:coverage-loop-command-compare"}:
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:coverage-loop-compare"},
                {"gate": "no_live_command_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "mock_cycle_report_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "mock_no_progress_cycle_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "mock_multi_cycle_report_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "mock_report_write_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "file_backed_mock_harvest_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "external_harvest_command_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "external_harvest_runtime_options_fixture", "status": "covered", "source": "python_backend.tests.test_corpus_contracts"},
                {"gate": "js_harvest_adapter_command_fixture", "status": "covered", "source": "python:coverage-loop-command-compare"},
                {"gate": "js_opt_in_python_command_bridge", "status": "covered", "source": "runCoverageHarvestLoopScript.test.js"},
                {"gate": "js_python_live_adapter_bridge_env_controls", "status": "covered", "source": "runCoverageHarvestLoopScript.test.js"},
                {"gate": "deferred_live_runtime_contract", "status": "covered", "source": "python:coverage-loop-command-compare"},
            ]
        if validation_script == "python:harvest-plan-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:harvest-plan-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareHarvestPlan.test.js"},
            ]
        if validation_script == "python:tieba-keyword-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:tieba-keyword-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "runTiebaKeywordScrape.test.js"},
                {"gate": "fixture_keyword_scrape", "status": "covered", "source": "python:tieba-keyword-compare"},
                {"gate": "python_corpus_update_bridge", "status": "covered", "source": "runTiebaKeywordScrape.test.js"},
            ]
        if validation_script == "python:aicu-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:aicu-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "scrapeAicuUsers.test.js"},
            ]
        if validation_script == "python:aicu-batch-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:aicu-batch-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareAicuBatchPlan.test.js"},
            ]
        if validation_script == "python:aicu-browser-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:aicu-browser-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareAicuBrowserBatchPlan.test.js"},
            ]
        if validation_script == "python:batch-bilibili-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:batch-bilibili-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareBatchBilibiliPlan.test.js"},
            ]
        if validation_script == "python:batch-popular-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:batch-popular-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareBatchPopularPlan.test.js"},
            ]
        if validation_script == "python:batch-scraper-launcher-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:batch-scraper-launcher-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareBatchScraperLauncherPlan.test.js"},
            ]
        if validation_script == "python:batch-uid-scrape-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:batch-uid-scrape-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareBatchUidScrapePlan.test.js"},
            ]
        if validation_script == "python:batch-uid-range-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:batch-uid-range-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareBatchUidRangePlan.test.js"},
            ]
        if validation_script == "python:uid-discovery-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-discovery-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidDiscoveryPlan.test.js"},
            ]
        if validation_script == "python:uid-range-scrape-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-range-scrape-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidRangeScrapePlan.test.js"},
            ]
        if validation_script == "python:uid-pipeline-launcher-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-pipeline-launcher-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidPipelineLauncherPlan.test.js"},
            ]
        if validation_script == "python:uid-pipeline-worker-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-pipeline-worker-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidPipelineWorkerPlan.test.js"},
            ]
        if validation_script == "python:uid-fast-pipeline-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-fast-pipeline-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidFastPipelinePlan.test.js"},
            ]
        if validation_script == "python:uid-fast-worker-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-fast-worker-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidFastPipelineWorkerPlan.test.js"},
            ]
        if validation_script == "python:uid-parallel-compare":
            return [
                {"gate": "dry_run_plan_fixture", "status": "covered", "source": "python:uid-parallel-compare"},
                {"gate": "js_python_plan_bridge", "status": "covered", "source": "compareUidParallelPlan.test.js"},
            ]
        if validation_scope == "full_command":
            return [{"gate": "full_command", "status": "covered", "source": validation_script}]
        return []


class PackageCommandMigrationInventory:
    """Map node-backed package commands to available Python compatibility commands."""

    def __init__(
        self,
        package: dict[str, Any] | None = None,
        equivalents: dict[str, str] | None = None,
        validation_equivalents: dict[str, str] | None = None,
        validation_scopes: dict[str, str] | None = None,
        replacement_scopes: dict[str, str] | None = None,
        retained_commands: dict[str, str] | None = None,
        bridge_commands: dict[str, str] | None = None,
    ):
        self.package = package if isinstance(package, dict) else {}
        self.equivalents = equivalents or DEFAULT_PACKAGE_COMMAND_EQUIVALENTS
        self.validation_equivalents = validation_equivalents or DEFAULT_PACKAGE_VALIDATION_EQUIVALENTS
        self.validation_scopes = validation_scopes or DEFAULT_PACKAGE_VALIDATION_SCOPES
        self.replacement_scopes = replacement_scopes or DEFAULT_PACKAGE_REPLACEMENT_SCOPES
        self.retained_commands = retained_commands or DEFAULT_RETAINED_NODE_COMMANDS
        self.bridge_commands = bridge_commands or DEFAULT_BRIDGE_NODE_COMMANDS

    @classmethod
    def from_root(cls, root: str | Path = ".") -> "PackageCommandMigrationInventory":
        package_path = Path(root) / "package.json"
        if not package_path.exists():
            return cls({})
        try:
            payload = json.loads(package_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        return cls(payload)

    def scan(self) -> dict[str, Any]:
        scripts = self.package.get("scripts")
        scripts = scripts if isinstance(scripts, dict) else {}
        node_scripts = self._node_server_scripts(scripts)
        python_scripts = self._python_backend_scripts(scripts)
        python_backed: list[dict[str, str]] = []
        retained: list[dict[str, str]] = []
        bridge: list[dict[str, str]] = []
        replacement_needed: list[dict[str, str]] = []
        linked_bridge_scripts = self._linked_bridge_scripts(node_scripts, python_scripts)

        for name, command in node_scripts.items():
            python_name = self.equivalents.get(name)
            python_command = python_scripts.get(python_name or "")
            if python_name and python_command:
                mapping = {
                    "script": name,
                    "command": command,
                    "pythonScript": python_name,
                    "pythonCommand": python_command,
                }
                replacement_scope = self.replacement_scopes.get(name)
                if replacement_scope:
                    mapping["replacementScope"] = replacement_scope
                    mapping["readyToReplace"] = False
                validation_name = self.validation_equivalents.get(name)
                validation_command = node_scripts.get(validation_name or "")
                if validation_name and validation_command:
                    mapping["validationScript"] = validation_name
                    mapping["validationCommand"] = validation_command
                    mapping["validationScope"] = self.validation_scopes.get(validation_name, "full_command")
                python_backed.append(mapping)
            elif name in linked_bridge_scripts:
                continue
            elif name in self.retained_commands:
                retained.append({"script": name, "command": command, "reason": self.retained_commands[name]})
            elif name in self.bridge_commands:
                bridge.append({"script": name, "command": command, "reason": self.bridge_commands[name]})
            else:
                replacement_needed.append({"script": name, "command": command})

        return {
            "nodeServerScripts": len(node_scripts),
            "pythonBackendScripts": len(python_scripts),
            "pythonBackedNodeScripts": python_backed,
            "retainedNodeScripts": retained,
            "bridgeNodeScripts": bridge,
            "replacementNeeded": replacement_needed,
            "pythonOwnedDataScripts": self._python_owned_data_scripts(python_scripts),
        }

    def _linked_bridge_scripts(self, node_scripts: dict[str, str], python_scripts: dict[str, str]) -> set[str]:
        linked: set[str] = set()
        for name in node_scripts:
            python_name = self.equivalents.get(name)
            validation_name = self.validation_equivalents.get(name)
            if python_name and python_scripts.get(python_name) and validation_name and node_scripts.get(validation_name):
                linked.add(validation_name)
        return linked

    @staticmethod
    def _node_server_scripts(scripts: dict[str, Any]) -> dict[str, str]:
        return {
            str(name): str(command)
            for name, command in scripts.items()
            if isinstance(command, str) and "node server/" in command
        }

    @staticmethod
    def _python_backend_scripts(scripts: dict[str, Any]) -> dict[str, str]:
        return {
            str(name): str(command)
            for name, command in scripts.items()
            if isinstance(command, str) and "python -m python_backend.cli." in command
        }

    @classmethod
    def _python_owned_data_scripts(cls, python_scripts: dict[str, str]) -> list[dict[str, str]]:
        owned: list[dict[str, str]] = []
        for name, command in python_scripts.items():
            pipeline = cls._python_owned_data_pipeline(command)
            if pipeline:
                owned.append({"script": name, "command": command, "pipeline": pipeline})
        return owned

    @staticmethod
    def _python_owned_data_pipeline(command: str) -> str:
        for pipeline, module_fragments in PYTHON_OWNED_DATA_PIPELINE_COMMANDS.items():
            if any(fragment in command for fragment in module_fragments):
                return pipeline
        return ""


@dataclass(frozen=True)
class BackendMigrationInventoryRequest:
    """Run a backend migration inventory request from normalized inputs."""

    root: str | Path = "."

    def run(self) -> dict[str, Any]:
        return BackendMigrationInventoryScanner(self.root).scan()


class BackendMigrationInventoryCommandRequest:
    """Own argv parsing for backend migration inventory JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BackendMigrationInventoryRequest(root=args.root).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Report remaining JS backend files for Python migration planning.")
        parser.add_argument("--root", default=".")
        return parser


class BackendMigrationInventoryRunner(BackendMigrationInventoryCommandRequest):
    """Analysis-layer runner for backend migration inventory requests."""
