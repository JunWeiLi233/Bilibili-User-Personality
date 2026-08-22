from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek_router import MODELS
from python_backend.analysis.audit import CoverageAuditBuilder
from python_backend.analysis.coverage_harvest_loop_runtime import (
    CoverageHarvestLoopExhaustedPruner,
    CoverageHarvestLoopExternalHarvestAdapter,
    CoverageHarvestLoopExternalHarvestRequestBuilder,
    CoverageHarvestLoopMockHarvestRunner,
    CoverageHarvestLoopRuntimeGate,
)
from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder
from python_backend.runtime.json_contracts import JsonContractReader


class CoverageHarvestLoopCommandRunner:
    """Run the file-backed coverage harvest-loop command for validated no-live gates."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path,
        state_path: str | Path,
        report_path: str | Path,
        max_cycles: int = 3,
        rounds_per_cycle: int = 1,
        max_queries: int | None = None,
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        include_danmaku: bool = False,
        reset_state: bool = False,
        skip_seen: bool = True,
        stop_on_no_progress: bool = False,
        prune_exhausted_after: int = 0,
        prune_include_partial: bool = False,
        generated_at: str | None = None,
        harvest_command_json: str | None = None,
        seed_queries: list[str] | None = None,
        controversy_queries: list[str] | None = None,
        discovery_mode: str | None = None,
        terms_per_family: int | None = None,
        query_variants_per_term: int | None = None,
        extra_query_templates: list[str] | None = None,
        exhausted_suggestion_templates: list[str] | None = None,
        discovery_limit: int | None = None,
        discovery_pages: int | None = None,
        include_generic_popular: bool | None = None,
        max_hard_missed_queries: int | None = None,
        stale_missed_discovery_limit: int | None = None,
        stale_missed_pages: int | None = None,
        coverage_mode: str | None = None,
        comment_pool_target_terms_limit: int | None = None,
        priority_comment_pool_targets: bool | None = None,
        pre_filter_comments_to_targets: bool | None = None,
        deepen_reply_threads: bool | None = None,
        verbose: bool | None = None,
        prioritize_near_target: bool | None = None,
        existing_terms_only: bool | None = None,
        controversial_popular_query_limit: int | None = None,
        controversial_popular_search_order: str | None = None,
        pages: int | None = None,
        per_query_timeout_ms: int | None = None,
        expand_targets_from_comments: bool | None = None,
    ):
        from python_backend.analysis.coverage_loop import (
            _flag_value,
            _float_or,
            _non_negative_int,
            _parse_list,
            _positive_int,
        )
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.report_path = Path(report_path)
        self.max_cycles = max(0, min(_non_negative_int(max_cycles, 3), 50))
        self.rounds_per_cycle = max(1, min(_positive_int(rounds_per_cycle, 1), 20))
        self.max_queries = max(1, min(_positive_int(max_queries, _positive_int(max_actions, 12)), 100))
        self.target_evidence = _positive_int(target_evidence, 3, 1000)
        self.max_actions = _positive_int(max_actions, 12, 1000)
        self.min_coverage_ratio = _float_or(min_coverage_ratio, 1)
        self.require_complete = bool(require_complete)
        self.require_source_backed_evidence = bool(require_source_backed_evidence)
        self.require_comment_backed_evidence = bool(require_comment_backed_evidence)
        self.prioritize_source_gaps = self.require_comment_backed_evidence
        self.retry_before_unattempted_limit = _non_negative_int(
            os.environ.get("BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT"),
            1 if self.require_comment_backed_evidence else 3,
            20,
        )
        self.include_danmaku = bool(include_danmaku)
        self.reset_state = bool(reset_state)
        self.skip_seen = bool(skip_seen)
        self.stop_on_no_progress = bool(stop_on_no_progress)
        self.prune_exhausted_after = max(0, _non_negative_int(prune_exhausted_after, 0, 100000))
        self.prune_include_partial = bool(prune_include_partial)
        self.generated_at = generated_at or self._now()
        self.deepseek = {
            "model": os.environ.get("BILIBILI_HARVEST_MODEL") or MODELS["V4_FLASH"],
            "reasoningEffort": os.environ.get("BILIBILI_HARVEST_REASONING_EFFORT") or "max",
        }
        existing_terms_only_value = (
            bool(existing_terms_only) if existing_terms_only is not None else os.environ.get("BILIBILI_HARVEST_EXISTING_TERMS_ONLY") == "1"
        )
        self.discovery_options = {
            "seedQueries": seed_queries
            if seed_queries is not None
            else _parse_list(os.environ.get("BILIBILI_VIDEO_SEARCH_QUERIES") or os.environ.get("BILIBILI_VIDEO_SEARCH_QUERY")),
            "controversyQueries": controversy_queries
            if controversy_queries is not None
            else _parse_list(os.environ.get("BILIBILI_CONTROVERSY_SEARCH_QUERIES") or os.environ.get("BILIBILI_CONTROVERSY_SEARCH_QUERY")),
            "discoveryMode": str(discovery_mode or os.environ.get("BILIBILI_VIDEO_DISCOVERY_MODE") or "controversial").strip().lower(),
            "termsPerFamily": _positive_int(
                terms_per_family if terms_per_family is not None else os.environ.get("BILIBILI_HARVEST_TERMS_PER_FAMILY"),
                4,
                20,
            ),
            "queryVariantsPerTerm": _positive_int(
                query_variants_per_term
                if query_variants_per_term is not None
                else os.environ.get("BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM"),
                2,
                20,
            ),
            "extraQueryTemplates": extra_query_templates
            if extra_query_templates is not None
            else _parse_list(os.environ.get("BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES")),
            "exhaustedSuggestionTemplates": exhausted_suggestion_templates
            if exhausted_suggestion_templates is not None
            else _parse_list(os.environ.get("BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES")),
            "maxHardMissedQueries": _non_negative_int(
                max_hard_missed_queries
                if max_hard_missed_queries is not None
                else os.environ.get("BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES"),
                max(2, (self.max_queries + 1) // 2),
                100,
            ),
            "staleMissedDiscoveryLimit": _non_negative_int(
                stale_missed_discovery_limit
                if stale_missed_discovery_limit is not None
                else os.environ.get("BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT"),
                4,
                20,
            ),
            "staleMissedPages": _non_negative_int(
                stale_missed_pages if stale_missed_pages is not None else os.environ.get("BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES"),
                3,
                5,
            ),
            "coverageMode": str(coverage_mode or os.environ.get("BILIBILI_HARVEST_COVERAGE_MODE") or "all-weak").strip().lower(),
            "commentPoolTargetTermsLimit": _positive_int(
                comment_pool_target_terms_limit
                if comment_pool_target_terms_limit is not None
                else os.environ.get("BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT"),
                24,
                200,
            ),
            "priorityCommentPoolTargets": bool(priority_comment_pool_targets)
            if priority_comment_pool_targets is not None
            else _flag_value(os.environ.get("BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS"), False),
            "preFilterCommentsToTargets": bool(pre_filter_comments_to_targets)
            if pre_filter_comments_to_targets is not None
            else _flag_value(os.environ.get("BILIBILI_HARVEST_PREFILTER_COMMENTS"), False),
            "deepenReplyThreads": bool(deepen_reply_threads)
            if deepen_reply_threads is not None
            else _flag_value(os.environ.get("BILIBILI_HARVEST_DEEPEN_REPLIES"), False),
            "verbose": bool(verbose) if verbose is not None else _flag_value(os.environ.get("BILIBILI_HARVEST_VERBOSE"), True),
            "prioritizeNearTarget": bool(prioritize_near_target)
            if prioritize_near_target is not None
            else _flag_value(os.environ.get("BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET"), False),
            "existingTermsOnly": existing_terms_only_value,
            "discoveryLimit": _positive_int(
                discovery_limit if discovery_limit is not None else os.environ.get("BILIBILI_VIDEO_DISCOVERY_LIMIT"),
                6,
                20,
            ),
            "discoveryPages": _positive_int(
                discovery_pages if discovery_pages is not None else os.environ.get("BILIBILI_VIDEO_DISCOVERY_PAGES"),
                1,
                5,
            ),
            "controversialPopularQueryLimit": _non_negative_int(
                controversial_popular_query_limit
                if controversial_popular_query_limit is not None
                else os.environ.get("BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT"),
                4,
                20,
            ),
            "controversialPopularSearchOrder": str(
                controversial_popular_search_order or os.environ.get("BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER") or "click"
            )
            .strip()
            .lower(),
            "includeGenericPopular": bool(include_generic_popular)
            if include_generic_popular is not None
            else _flag_value(os.environ.get("BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR"), False),
            "pages": _positive_int(pages if pages is not None else os.environ.get("BILIBILI_VIDEO_COMMENT_PAGES"), 2, 20),
            "perQueryTimeoutMs": _positive_int(
                per_query_timeout_ms if per_query_timeout_ms is not None else os.environ.get("BILIBILI_HARVEST_QUERY_TIMEOUT_MS"),
                180000,
                30 * 60 * 1000,
            ),
            "expandTargetsFromComments": bool(expand_targets_from_comments)
            if expand_targets_from_comments is not None
            else _flag_value(
                os.environ.get("BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS"),
                existing_terms_only_value and self.require_comment_backed_evidence,
            ),
        }
        self.runtime_gate = CoverageHarvestLoopRuntimeGate()
        self.harvest_adapter = CoverageHarvestLoopExternalHarvestAdapter(harvest_command_json) if harvest_command_json else None
        self.audit_builder = CoverageAuditBuilder(
            target_evidence=self.target_evidence,
            max_actions=self.max_actions,
            min_coverage_ratio=self.min_coverage_ratio,
            require_complete=self.require_complete,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
        )

    def run(self) -> dict[str, Any]:
        dictionary = JsonContractReader({"version": 1, "entries": []}).read_object(self.dictionary_path)
        audit = self.audit_builder.build(dictionary)
        if self.harvest_adapter and audit.get("ok") is not True and self.max_cycles > 0:
            return self._run_external_harvest_loop(dictionary=dictionary, audit=audit)
        stop_reason = self._stop_reason(audit)
        report = {
            "generatedAt": self.generated_at,
            "maxCycles": self.max_cycles,
            "roundsPerCycle": self.rounds_per_cycle,
            "stopReason": stop_reason,
            "finalOk": audit.get("ok") is True,
            "finalAudit": audit,
            "cycles": [],
            **self.runtime_gate.describe(audit=audit, max_cycles=self.max_cycles),
        }
        self._write_report(report)
        return report

    def _run_external_harvest_loop(self, *, dictionary: dict[str, Any], audit: dict[str, Any]) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import (
            CoverageHarvestLoopCycleReportBuilder,
            CoverageHarvestLoopPlanner,
            _exception_text,
        )
        cycles: list[dict[str, Any]] = []
        current_dictionary = dictionary
        current_audit = audit
        stop_reason = "cycle_limit"
        report_builder = CoverageHarvestLoopCycleReportBuilder(
            generated_at=self.generated_at,
            max_cycles=self.max_cycles,
            rounds_per_cycle=self.rounds_per_cycle,
        )
        planner = CoverageHarvestLoopPlanner()
        request_builder = CoverageHarvestLoopExternalHarvestRequestBuilder(
            dictionary_path=self.dictionary_path,
            state_path=self.state_path,
            report_path=self.report_path,
            deepseek=self.deepseek,
            rounds_per_cycle=self.rounds_per_cycle,
            max_queries=self.max_queries,
            target_evidence=self.target_evidence,
            max_actions=self.max_actions,
            min_coverage_ratio=self.min_coverage_ratio,
            require_complete=self.require_complete,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            prioritize_source_gaps=self.prioritize_source_gaps,
            retry_before_unattempted_limit=self.retry_before_unattempted_limit,
            include_danmaku=self.include_danmaku,
            reset_state=self.reset_state,
            skip_seen=self.skip_seen,
            discovery_options=self.discovery_options,
        )

        for cycle in range(1, self.max_cycles + 1):
            priority_queries = planner.priority_query_items_from_audit(current_audit, self.max_queries)
            if not priority_queries:
                stop_reason = "no_recommended_queries"
                break
            try:
                response = self.harvest_adapter.run(
                    request_builder.build(cycle=cycle, audit=current_audit, priority_queries=priority_queries)
                )
            except Exception as error:
                stop_reason = f"cycle_{cycle}_crashed"
                cycles.append(
                    {
                        "cycle": cycle,
                        "priorityQueries": [],
                        "harvest": {
                            "ok": False,
                            "rounds": 0,
                            "queries": [],
                            "warnings": [_exception_text(error)],
                            "coverageProgress": [],
                            "trainingDiagnostics": [],
                            "queryDiagnostics": [],
                        },
                        "coverageDelta": None,
                        "coverageBefore": current_audit.get("coverage") if isinstance(current_audit.get("coverage"), dict) else {},
                        "coverageAfter": current_audit.get("coverage") if isinstance(current_audit.get("coverage"), dict) else {},
                    }
                )
                break
            response_dictionary = response.get("afterDictionary")
            if isinstance(response_dictionary, dict):
                next_dictionary = response_dictionary
                self._write_dictionary(next_dictionary)
            else:
                next_dictionary = current_dictionary
            response_state = response.get("afterState")
            if isinstance(response_state, dict):
                self._write_state(response_state)
            next_audit = self.audit_builder.build(next_dictionary)
            cycle_report = report_builder.build(
                cycle=cycle,
                priority_queries=priority_queries,
                harvest=response.get("harvest") if isinstance(response.get("harvest"), dict) else {},
                before_audit=current_audit,
                after_audit=next_audit,
            )
            cycles.extend(cycle_report["cycles"])
            current_dictionary = next_dictionary
            current_audit = next_audit
            latest_harvest = cycle_report["cycles"][0].get("harvest") if cycle_report["cycles"] else {}
            executed_queries = latest_harvest.get("queries") if isinstance(latest_harvest, dict) else []
            if self.prune_exhausted_after > 0:
                prune_result = CoverageHarvestLoopExhaustedPruner(
                    dictionary_path=self.dictionary_path,
                    state_path=self.state_path,
                    target_evidence=self.target_evidence,
                    attempt_threshold=self.prune_exhausted_after,
                    include_partial=self.prune_include_partial,
                    require_source_backed_evidence=self.require_source_backed_evidence,
                    require_comment_backed_evidence=self.require_comment_backed_evidence,
                ).run(current_dictionary)
                if prune_result.get("pruned"):
                    current_dictionary = prune_result["dictionary"]
                    current_audit = self.audit_builder.build(current_dictionary)
            if isinstance(executed_queries, list) and not executed_queries:
                stop_reason = "no_queries_run"
                break
            if current_audit.get("ok") is True:
                stop_reason = "coverage_gate_passed"
                break
            latest_delta = cycle_report["cycles"][0].get("coverageDelta") if cycle_report["cycles"] else {}
            if self.stop_on_no_progress and not report_builder.progress_tracker.has_coverage_delta_progress(latest_delta):
                stop_reason = "no_coverage_progress"
                break

        report = {
            "generatedAt": self.generated_at,
            "maxCycles": self.max_cycles,
            "roundsPerCycle": self.rounds_per_cycle,
            "stopReason": stop_reason,
            "finalOk": current_audit.get("ok") is True,
            "finalAudit": current_audit,
            "cycles": cycles,
            "runtimeMode": "external_harvest_command",
        }
        self._write_report(report)
        return report

    def _stop_reason(self, audit: dict[str, Any]) -> str:
        if audit.get("ok") is True:
            return "coverage_gate_passed"
        if self.max_cycles == 0:
            return "cycle_limit"
        return "live_harvest_not_implemented"

    def _write_report(self, report: dict[str, Any]) -> None:
        self.write_report_file(self.report_path, report)

    def _write_dictionary(self, dictionary: dict[str, Any]) -> None:
        self.write_report_file(self.dictionary_path, dictionary)

    def _write_state(self, state: dict[str, Any]) -> None:
        self.write_report_file(self.state_path, state)

    @staticmethod
    def write_report_file(report_path: str | Path, report: dict[str, Any]) -> None:
        path = Path(report_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class CoverageHarvestLoopRequest:
    """Analysis-layer request for the file-backed coverage harvest-loop command."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path,
        state_path: str | Path,
        report_path: str | Path,
        max_cycles: int = 3,
        rounds_per_cycle: int = 1,
        max_queries: int | None = None,
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        include_danmaku: bool = False,
        reset_state: bool = False,
        skip_seen: bool = True,
        stop_on_no_progress: bool = False,
        prune_exhausted_after: int = 0,
        prune_include_partial: bool = False,
        generated_at: str | None = None,
        harvest_command_json: str | None = None,
        seed_queries: list[str] | None = None,
        controversy_queries: list[str] | None = None,
        discovery_mode: str | None = None,
        terms_per_family: int | None = None,
        query_variants_per_term: int | None = None,
        extra_query_templates: list[str] | None = None,
        exhausted_suggestion_templates: list[str] | None = None,
        discovery_limit: int | None = None,
        discovery_pages: int | None = None,
        include_generic_popular: bool | None = None,
        max_hard_missed_queries: int | None = None,
        stale_missed_discovery_limit: int | None = None,
        stale_missed_pages: int | None = None,
        coverage_mode: str | None = None,
        comment_pool_target_terms_limit: int | None = None,
        priority_comment_pool_targets: bool | None = None,
        pre_filter_comments_to_targets: bool | None = None,
        deepen_reply_threads: bool | None = None,
        verbose: bool | None = None,
        prioritize_near_target: bool | None = None,
        existing_terms_only: bool | None = None,
        controversial_popular_query_limit: int | None = None,
        controversial_popular_search_order: str | None = None,
        pages: int | None = None,
        per_query_timeout_ms: int | None = None,
        expand_targets_from_comments: bool | None = None,
    ):
        self.runner = CoverageHarvestLoopCommandRunner(
            dictionary_path=dictionary_path,
            state_path=state_path,
            report_path=report_path,
            max_cycles=max_cycles,
            rounds_per_cycle=rounds_per_cycle,
            max_queries=max_queries,
            target_evidence=target_evidence,
            max_actions=max_actions,
            min_coverage_ratio=min_coverage_ratio,
            require_complete=require_complete,
            require_source_backed_evidence=require_source_backed_evidence,
            require_comment_backed_evidence=require_comment_backed_evidence,
            include_danmaku=include_danmaku,
            reset_state=reset_state,
            skip_seen=skip_seen,
            stop_on_no_progress=stop_on_no_progress,
            prune_exhausted_after=prune_exhausted_after,
            prune_include_partial=prune_include_partial,
            generated_at=generated_at,
            harvest_command_json=harvest_command_json,
            seed_queries=seed_queries,
            controversy_queries=controversy_queries,
            discovery_mode=discovery_mode,
            terms_per_family=terms_per_family,
            query_variants_per_term=query_variants_per_term,
            extra_query_templates=extra_query_templates,
            exhausted_suggestion_templates=exhausted_suggestion_templates,
            discovery_limit=discovery_limit,
            discovery_pages=discovery_pages,
            include_generic_popular=include_generic_popular,
            max_hard_missed_queries=max_hard_missed_queries,
            stale_missed_discovery_limit=stale_missed_discovery_limit,
            stale_missed_pages=stale_missed_pages,
            coverage_mode=coverage_mode,
            comment_pool_target_terms_limit=comment_pool_target_terms_limit,
            priority_comment_pool_targets=priority_comment_pool_targets,
            pre_filter_comments_to_targets=pre_filter_comments_to_targets,
            deepen_reply_threads=deepen_reply_threads,
            verbose=verbose,
            prioritize_near_target=prioritize_near_target,
            existing_terms_only=existing_terms_only,
            controversial_popular_query_limit=controversial_popular_query_limit,
            controversial_popular_search_order=controversial_popular_search_order,
            pages=pages,
            per_query_timeout_ms=per_query_timeout_ms,
            expand_targets_from_comments=expand_targets_from_comments,
        )

    def run(self) -> dict[str, Any]:
        return self.runner.run()


class CoverageHarvestLoopCommandRequest:
    """Argv parser for the file-backed coverage harvest-loop command."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import (
            CoverageHarvestLoopCycleReportBuilder,
            CoverageHarvestLoopCommandRunner as _CoverageHarvestLoopCommandRunner,
            _parse_many,
        )
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.harvest_command_preflight:
            return CoverageHarvestLoopExternalHarvestAdapter(args.harvest_command_json).preflight()
        if args.mock_cycle_payload:
            payload = JsonContractReader().read_value(args.mock_cycle_payload, {})
            payload = payload if isinstance(payload, dict) else {}
            builder = CoverageHarvestLoopCycleReportBuilder(
                generated_at=payload.get("generatedAt") or args.generated_at or None,
                max_cycles=payload.get("maxCycles", args.max_cycles),
                rounds_per_cycle=payload.get("roundsPerCycle", args.rounds_per_cycle),
            )
            if isinstance(payload.get("cycles"), list):
                report = builder.build_many(
                    payload.get("cycles"),
                    stop_reason=str(payload.get("stopReason") or ""),
                )
                _CoverageHarvestLoopCommandRunner.write_report_file(args.report, report)
                return report
            report = builder.build(
                cycle=payload.get("cycle", 1),
                priority_queries=payload.get("priorityQueries") if isinstance(payload.get("priorityQueries"), list) else [],
                harvest=payload.get("harvest") if isinstance(payload.get("harvest"), dict) else {},
                before_audit=payload.get("beforeAudit") if isinstance(payload.get("beforeAudit"), dict) else {},
                after_audit=payload.get("afterAudit") if isinstance(payload.get("afterAudit"), dict) else {},
                stop_reason=str(payload.get("stopReason") or ""),
            )
            _CoverageHarvestLoopCommandRunner.write_report_file(args.report, report)
            return report
        if args.mock_harvest_payload:
            return CoverageHarvestLoopMockHarvestRunner(
                dictionary_path=args.dictionary,
                report_path=args.report,
                payload_path=args.mock_harvest_payload,
                max_cycles=args.max_cycles,
                rounds_per_cycle=args.rounds_per_cycle,
                target_evidence=args.target_evidence,
                max_actions=args.max_actions,
                min_coverage_ratio=args.min_coverage_ratio,
                require_complete=not args.allow_incomplete,
                require_source_backed_evidence=args.require_source_backed_evidence,
                require_comment_backed_evidence=args.require_comment_backed_evidence,
                generated_at=args.generated_at or None,
            ).run()
        return CoverageHarvestLoopRequest(
            dictionary_path=args.dictionary,
            state_path=args.state,
            report_path=args.report,
            max_cycles=args.max_cycles,
            rounds_per_cycle=args.rounds_per_cycle,
            max_queries=args.max_queries,
            target_evidence=args.target_evidence,
            max_actions=args.max_actions,
            min_coverage_ratio=args.min_coverage_ratio,
            require_complete=not args.allow_incomplete,
            require_source_backed_evidence=args.require_source_backed_evidence,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
            include_danmaku=args.include_danmaku,
            reset_state=args.reset_state,
            skip_seen=not args.no_skip_seen,
            stop_on_no_progress=args.stop_on_no_progress,
            prune_exhausted_after=args.prune_exhausted_after,
            prune_include_partial=args.prune_include_partial,
            generated_at=args.generated_at or None,
            harvest_command_json=args.harvest_command_json or None,
            seed_queries=_parse_many(args.seed_query),
            controversy_queries=_parse_many(args.controversy_query),
            discovery_mode=args.discovery_mode or None,
            terms_per_family=args.terms_per_family,
            query_variants_per_term=args.query_variants_per_term,
            extra_query_templates=_parse_many(args.extra_query_template),
            exhausted_suggestion_templates=_parse_many(args.exhausted_suggestion_template),
            discovery_limit=args.discovery_limit,
            discovery_pages=args.discovery_pages,
            include_generic_popular=True if args.include_generic_popular else None,
            max_hard_missed_queries=args.max_hard_missed_queries,
            stale_missed_discovery_limit=args.stale_missed_discovery_limit,
            stale_missed_pages=args.stale_missed_pages,
            coverage_mode=args.coverage_mode or None,
            comment_pool_target_terms_limit=args.comment_pool_target_limit,
            priority_comment_pool_targets=True if args.priority_comment_pool_targets else None,
            pre_filter_comments_to_targets=True if args.pre_filter_comments_to_targets else None,
            deepen_reply_threads=True if args.deepen_reply_threads else None,
            verbose=False if args.quiet else None,
            prioritize_near_target=True if args.prioritize_near_target else None,
            existing_terms_only=True if args.existing_terms_only else None,
            controversial_popular_query_limit=args.controversial_popular_query_limit,
            controversial_popular_search_order=args.controversial_popular_search_order or None,
            pages=args.pages,
            per_query_timeout_ms=args.per_query_timeout_ms,
            expand_targets_from_comments=True if args.expand_targets_from_comments else None,
        ).run()

    def exit_zero(self) -> bool:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return bool(args.exit_zero)

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Run the Python coverage harvest-loop command.")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--state", default="server/data/keywordHarvestState.json")
        parser.add_argument("--report", default="server/data/keywordCoverageLoopReport.json")
        parser.add_argument("--max-cycles", type=int, default=3)
        parser.add_argument("--rounds-per-cycle", type=int, default=1)
        parser.add_argument("--max-queries", type=int, default=None)
        parser.add_argument("--target-evidence", type=int, default=3)
        parser.add_argument("--max-actions", type=int, default=12)
        parser.add_argument("--min-coverage-ratio", type=float, default=1)
        parser.add_argument("--allow-incomplete", action="store_true")
        parser.add_argument("--require-source-backed-evidence", action="store_true")
        parser.add_argument("--require-comment-backed-evidence", action="store_true")
        parser.add_argument("--include-danmaku", action="store_true")
        parser.add_argument("--reset-state", action="store_true")
        parser.add_argument("--no-skip-seen", action="store_true")
        parser.add_argument("--stop-on-no-progress", action="store_true")
        parser.add_argument("--prune-exhausted-after", type=int, default=0)
        parser.add_argument("--prune-include-partial", action="store_true")
        parser.add_argument("--generated-at", default="")
        parser.add_argument("--seed-query", action="append", default=None, help="Seed query for external harvest adapters; repeat or comma-separate.")
        parser.add_argument("--controversy-query", action="append", default=None, help="Controversy query for external harvest adapters; repeat or comma-separate.")
        parser.add_argument("--discovery-mode", default="")
        parser.add_argument("--terms-per-family", type=int, default=None)
        parser.add_argument("--query-variants-per-term", type=int, default=None)
        parser.add_argument("--extra-query-template", action="append", default=None, help="Extra query template; repeat or comma-separate.")
        parser.add_argument("--exhausted-suggestion-template", action="append", default=None, help="Suggestion template for exhausted terms; repeat or comma-separate.")
        parser.add_argument("--discovery-limit", type=int, default=None)
        parser.add_argument("--discovery-pages", type=int, default=None)
        parser.add_argument("--include-generic-popular", action="store_true")
        parser.add_argument("--max-hard-missed-queries", type=int, default=None)
        parser.add_argument("--stale-missed-discovery-limit", type=int, default=None)
        parser.add_argument("--stale-missed-pages", type=int, default=None)
        parser.add_argument("--coverage-mode", default="")
        parser.add_argument("--comment-pool-target-limit", type=int, default=None)
        parser.add_argument("--priority-comment-pool-targets", action="store_true")
        parser.add_argument("--pre-filter-comments-to-targets", action="store_true")
        parser.add_argument("--deepen-reply-threads", action="store_true")
        parser.add_argument("--quiet", action="store_true")
        parser.add_argument("--prioritize-near-target", action="store_true")
        parser.add_argument("--existing-terms-only", action="store_true")
        parser.add_argument("--controversial-popular-query-limit", type=int, default=None)
        parser.add_argument("--controversial-popular-search-order", default="")
        parser.add_argument("--pages", type=int, default=None)
        parser.add_argument("--per-query-timeout-ms", type=int, default=None)
        parser.add_argument("--expand-targets-from-comments", action="store_true")
        parser.add_argument("--mock-cycle-payload", default="", help="Build a one-cycle report from a JSON payload without live harvesting.")
        parser.add_argument("--mock-harvest-payload", default="", help="Build a file-backed harvest cycle report from a JSON payload without live network harvesting.")
        parser.add_argument("--harvest-command-json", default="", help="JSON array command for an external harvest adapter. Use {payload} for the request path.")
        parser.add_argument("--harvest-command-preflight", action="store_true", help="Describe the external harvest adapter command without executing it.")
        parser.add_argument("--exit-zero", action="store_true")
        return parser
