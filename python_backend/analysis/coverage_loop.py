from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder
from python_backend.analysis.coverage_progress import CoverageProgressTracker
from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


def _positive_int(value: Any, fallback: int, maximum: int | None = None) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not number > 0:
        return fallback
    result = int(number)
    return min(result, maximum) if maximum is not None else result


def _non_negative_int(value: Any, fallback: int, maximum: int | None = None) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not number >= 0:
        return fallback
    result = int(number)
    return min(result, maximum) if maximum is not None else result


def _flag_value(value: Any, fallback: bool = False) -> bool:
    if value is None or value == "":
        return fallback
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_list(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


class CoverageHarvestLoopPlanSummary:
    """Shape coverage-harvest loop plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "deepseek",
        "paths",
        "loop",
        "auditOptions",
        "harvestOptions",
        "lists",
        "prune",
        "strict",
        "priorityQueries",
        "initialStopReason",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class CoverageHarvestLoopPlanContractComparator:
    """Compare coverage-harvest loop plans using the JS/Python summary contract."""

    def __init__(self, summary: CoverageHarvestLoopPlanSummary | None = None):
        self.summary = summary or CoverageHarvestLoopPlanSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class CoverageHarvestLoopPlanRunner:
    """Build an auto coverage-harvest loop plan from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return CoverageHarvestLoopPlanner().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class CoverageHarvestLoopPlanPayloadContractComparator:
    """Compare Python coverage-loop plan output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CoverageHarvestLoopPlanSummary()
        self.comparator = CoverageHarvestLoopPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = CoverageHarvestLoopPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class CoverageHarvestLoopPlanRequest:
    """Analysis-layer request object for coverage harvest-loop plan JSON contract modes."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return CoverageHarvestLoopPlanPayloadContractComparator(
                self.payload_path,
                self.compare_js_report_path,
            ).compare()
        return CoverageHarvestLoopPlanRunner(self.payload_path).run()


class CoverageHarvestLoopPlanCommandRequest:
    """Analysis-layer command request for coverage harvest-loop plan JSON contract modes."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CoverageHarvestLoopPlanRequest(
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a coverage harvest loop plan from a JSON payload.")
        parser.add_argument("--payload", required=True, help="Path to coverage-loop payload JSON.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible coverage-loop report to compare.")
        return parser


class CoverageHarvestLoopPlanner:
    """Build the JS-compatible auto coverage-harvest loop plan without running network work."""

    def __init__(self, cwd: str | Path | None = None):
        self.cwd = Path(cwd) if cwd is not None else Path.cwd()

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        planner = self if not payload.get("cwd") else CoverageHarvestLoopPlanner(cwd=payload.get("cwd"))
        plan = planner.build_plan(
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
        )
        audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else {}
        priority_queries = planner.priority_query_items_from_audit(audit, plan["loop"]["maxQueries"])
        return {
            **plan,
            "priorityQueries": priority_queries,
            "initialStopReason": planner.initial_stop_reason(audit, plan["loop"]["maxCycles"]),
        }

    def build_plan(self, env: dict[str, Any] | None = None, argv: list[Any] | None = None) -> dict[str, Any]:
        env = env or {}
        argv = argv or []
        data_dir = self.cwd / "server" / "data"
        max_cycles = _non_negative_int(env.get("BILIBILI_COVERAGE_LOOP_MAX_CYCLES"), 3, 50)
        rounds_fallback = _positive_int(env.get("BILIBILI_HARVEST_ROUNDS"), 1)
        rounds_per_cycle = _positive_int(env.get("BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE"), rounds_fallback, 20)
        max_queries = _positive_int(env.get("BILIBILI_HARVEST_MAX_QUERIES"), 12, 100)
        runtime = CoverageRuntimeOptionsBuilder().build(argv=argv, env=env, max_actions_fallback=max_queries)

        seed_queries = _parse_list(env.get("BILIBILI_VIDEO_SEARCH_QUERIES") or env.get("BILIBILI_VIDEO_SEARCH_QUERY"))
        controversy_queries = _parse_list(env.get("BILIBILI_CONTROVERSY_SEARCH_QUERIES") or env.get("BILIBILI_CONTROVERSY_SEARCH_QUERY"))
        extra_templates = _parse_list(env.get("BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES"))
        exhausted_templates = _parse_list(env.get("BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES"))
        existing_terms_only = env.get("BILIBILI_HARVEST_EXISTING_TERMS_ONLY") == "1"
        require_comment_backed = bool(runtime["requireCommentBackedEvidence"])
        expand_fallback = existing_terms_only and require_comment_backed

        audit_options = {
            "dictionaryPath": env.get("DEEPSEEK_KEYWORD_DICTIONARY_PATH"),
            "statePath": env.get("BILIBILI_HARVEST_STATE_PATH") or str(data_dir / "keywordHarvestState.json"),
            "targetEvidence": runtime["targetEvidence"],
            "maxActions": runtime["maxActions"],
            "minCoverageRatio": runtime["minCoverageRatio"],
            "requireComplete": runtime["requireComplete"],
            "requireSourceBackedEvidence": runtime["requireSourceBackedEvidence"],
            "requireCommentBackedEvidence": runtime["requireCommentBackedEvidence"],
            "prioritizeSourceGaps": require_comment_backed,
            "prioritizeNearTarget": _flag_value(env.get("BILIBILI_HARVEST_PRIORITIZE_NEAR_TARGET"), False),
            "extraQueryTemplates": extra_templates,
            "exhaustedSuggestionTemplates": exhausted_templates,
            "retryBeforeUnattemptedLimit": runtime["retryBeforeUnattemptedLimit"],
        }
        harvest_options = {
            "priorityQueries": [],
            "seedQueries": seed_queries,
            "controversyQueries": controversy_queries,
            "maxQueries": max_queries,
            "termsPerFamily": _positive_int(env.get("BILIBILI_HARVEST_TERMS_PER_FAMILY"), 4, 20),
            "queryVariantsPerTerm": _positive_int(env.get("BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM"), 2, 20),
            "extraQueryTemplates": extra_templates,
            "exhaustedSuggestionTemplates": exhausted_templates,
            "retryBeforeUnattemptedLimit": runtime["retryBeforeUnattemptedLimit"],
            "maxHardMissedQueries": _non_negative_int(env.get("BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES"), max(2, (max_queries + 1) // 2), 100),
            "staleMissedDiscoveryLimit": _non_negative_int(env.get("BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT"), 4, 20),
            "staleMissedPages": _non_negative_int(env.get("BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES"), 3, 5),
            "targetEvidence": runtime["targetEvidence"],
            "coverageMode": str(env.get("BILIBILI_HARVEST_COVERAGE_MODE") or "all-weak").strip().lower(),
            "requireSourceBackedEvidence": runtime["requireSourceBackedEvidence"],
            "requireCommentBackedEvidence": runtime["requireCommentBackedEvidence"],
            "prioritizeSourceGaps": require_comment_backed,
            "commentPoolTargetTermsLimit": _positive_int(env.get("BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT"), 24, 200),
            "priorityCommentPoolTargets": _flag_value(env.get("BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS"), False),
            "preFilterCommentsToTargets": _flag_value(env.get("BILIBILI_HARVEST_PREFILTER_COMMENTS"), False),
            "deepenReplyThreads": _flag_value(env.get("BILIBILI_HARVEST_DEEPEN_REPLIES"), False),
            "verbose": _flag_value(env.get("BILIBILI_HARVEST_VERBOSE"), True),
            "prioritizeNearTarget": audit_options["prioritizeNearTarget"],
            "existingTermsOnly": existing_terms_only,
            "discoveryMode": str(env.get("BILIBILI_VIDEO_DISCOVERY_MODE") or "controversial").strip().lower(),
            "discoveryLimit": _positive_int(env.get("BILIBILI_VIDEO_DISCOVERY_LIMIT"), 6, 20),
            "discoveryPages": _positive_int(env.get("BILIBILI_VIDEO_DISCOVERY_PAGES"), 1, 5),
            "controversialPopularQueryLimit": _non_negative_int(env.get("BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT"), 4, 20),
            "controversialPopularSearchOrder": str(env.get("BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER") or "click").strip().lower(),
            "includeGenericPopular": _flag_value(env.get("BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR"), False),
            "includeDanmaku": _flag_value(env.get("BILIBILI_HARVEST_INCLUDE_DANMAKU"), False),
            "pages": _positive_int(env.get("BILIBILI_VIDEO_COMMENT_PAGES"), 2, 20),
            "perQueryTimeoutMs": _positive_int(env.get("BILIBILI_HARVEST_QUERY_TIMEOUT_MS"), 180000, 30 * 60 * 1000),
            "expandTargetsFromComments": _flag_value(env.get("BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS"), expand_fallback),
            "rounds": rounds_per_cycle,
            "statePath": audit_options["statePath"],
            "resetState": env.get("BILIBILI_HARVEST_RESET") == "1",
            "skipSeen": env.get("BILIBILI_HARVEST_SKIP_SEEN") != "0",
        }
        return {
            "ok": True,
            "deepseek": {
                "model": env.get("BILIBILI_HARVEST_MODEL") or "deepseek-v4-flash",
                "reasoningEffort": env.get("BILIBILI_HARVEST_REASONING_EFFORT") or "max",
            },
            "paths": {
                "dictionaryPath": audit_options["dictionaryPath"],
                "statePath": audit_options["statePath"],
                "reportPath": env.get("BILIBILI_COVERAGE_LOOP_REPORT_PATH") or str(data_dir / "keywordCoverageLoopReport.json"),
            },
            "loop": {"maxCycles": max_cycles, "roundsPerCycle": rounds_per_cycle, "maxQueries": max_queries},
            "auditOptions": audit_options,
            "harvestOptions": harvest_options,
            "lists": {
                "seedQueries": seed_queries,
                "controversyQueries": controversy_queries,
                "extraQueryTemplates": extra_templates,
                "exhaustedSuggestionTemplates": exhausted_templates,
            },
            "prune": {
                "pruneExhaustedAfter": _non_negative_int(env.get("BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER"), 0, 100000),
                "pruneIncludePartial": env.get("BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL") == "1",
            },
            "strict": runtime["strict"],
        }

    def priority_query_items_from_audit(self, audit: dict[str, Any] | None, limit: int) -> list[dict[str, Any]]:
        items = audit.get("nextActions") if isinstance(audit, dict) else []
        if not isinstance(items, list):
            return []
        result: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            queries = [item.get("nextQuery")]
            suggested = item.get("suggestedQueries")
            if isinstance(suggested, list):
                queries.extend(suggested)
            for raw_query in queries:
                query = str(raw_query or "").strip()
                if not query:
                    continue
                normalized = dict(item)
                normalized["query"] = query
                normalized["nextQuery"] = query
                result.append(normalized)
                if len(result) >= limit:
                    return result
        return result

    def initial_stop_reason(self, audit: dict[str, Any] | None, max_cycles: int) -> str:
        if isinstance(audit, dict) and audit.get("ok"):
            return "coverage_gate_passed"
        return "cycle_limit" if max_cycles == 0 else ""


class CoverageHarvestLoopCycleReportBuilder:
    """Build one JS-compatible coverage-loop cycle report from JSON contract payloads."""

    def __init__(
        self,
        *,
        generated_at: str | None = None,
        max_cycles: int = 1,
        rounds_per_cycle: int = 1,
        progress_tracker: CoverageProgressTracker | None = None,
    ):
        self.generated_at = generated_at or CoverageHarvestLoopCommandRunner._now()
        self.max_cycles = max(0, min(_non_negative_int(max_cycles, 1), 50))
        self.rounds_per_cycle = max(1, min(_positive_int(rounds_per_cycle, 1), 20))
        self.progress_tracker = progress_tracker or CoverageProgressTracker()

    def build(
        self,
        *,
        cycle: int,
        priority_queries: list[dict[str, Any]] | None = None,
        harvest: dict[str, Any] | None = None,
        before_audit: dict[str, Any] | None = None,
        after_audit: dict[str, Any] | None = None,
        stop_reason: str = "",
    ) -> dict[str, Any]:
        before_audit = before_audit if isinstance(before_audit, dict) else {}
        after_audit = after_audit if isinstance(after_audit, dict) else {}
        before_coverage = before_audit.get("coverage") if isinstance(before_audit.get("coverage"), dict) else {}
        after_coverage = after_audit.get("coverage") if isinstance(after_audit.get("coverage"), dict) else {}
        harvest_summary = self._harvest_summary(harvest)
        return {
            "generatedAt": self.generated_at,
            "maxCycles": self.max_cycles,
            "roundsPerCycle": self.rounds_per_cycle,
            "stopReason": stop_reason or ("coverage_gate_passed" if after_audit.get("ok") is True else ""),
            "finalOk": after_audit.get("ok") is True,
            "finalAudit": after_audit,
            "cycles": [
                {
                    "cycle": _positive_int(cycle, 1),
                    "priorityQueries": priority_queries if isinstance(priority_queries, list) else [],
                    "harvest": harvest_summary,
                    "coverageDelta": self.progress_tracker.coverage_delta_from_harvest(
                        before_coverage,
                        after_coverage,
                        harvest_summary["coverageProgress"],
                    ),
                    "coverageBefore": before_coverage,
                    "coverageAfter": after_coverage,
                }
            ],
        }

    def _harvest_summary(self, harvest: dict[str, Any] | None = None) -> dict[str, Any]:
        harvest = harvest if isinstance(harvest, dict) else {}
        rounds = harvest.get("rounds") if isinstance(harvest.get("rounds"), list) else []
        return {
            "ok": harvest.get("ok") is True,
            "rounds": len(rounds),
            "queries": [query for round_item in rounds if isinstance(round_item, dict) for query in self._list(round_item.get("queries"))],
            "warnings": [warning for round_item in rounds if isinstance(round_item, dict) for warning in self._list(round_item.get("warnings"))],
            "coverageProgress": [round_item.get("coverageProgress") for round_item in rounds if isinstance(round_item, dict)],
            "trainingDiagnostics": [round_item.get("trainingDiagnostics") for round_item in rounds if isinstance(round_item, dict)],
            "queryDiagnostics": [
                round_item.get("queryDiagnostics") if isinstance(round_item.get("queryDiagnostics"), list) else []
                for round_item in rounds
                if isinstance(round_item, dict)
            ],
        }

    @staticmethod
    def _list(value: Any) -> list[Any]:
        return value if isinstance(value, list) else []


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
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        generated_at: str | None = None,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.report_path = Path(report_path)
        self.max_cycles = max(0, min(_non_negative_int(max_cycles, 3), 50))
        self.rounds_per_cycle = max(1, min(_positive_int(rounds_per_cycle, 1), 20))
        self.generated_at = generated_at or self._now()
        self.audit_builder = CoverageAuditBuilder(
            target_evidence=target_evidence,
            max_actions=max_actions,
            min_coverage_ratio=min_coverage_ratio,
            require_complete=require_complete,
            require_source_backed_evidence=require_source_backed_evidence,
            require_comment_backed_evidence=require_comment_backed_evidence,
        )

    def run(self) -> dict[str, Any]:
        dictionary = JsonContractReader({"version": 1, "entries": []}).read_object(self.dictionary_path)
        audit = self.audit_builder.build(dictionary)
        stop_reason = self._stop_reason(audit)
        report = {
            "generatedAt": self.generated_at,
            "maxCycles": self.max_cycles,
            "roundsPerCycle": self.rounds_per_cycle,
            "stopReason": stop_reason,
            "finalOk": audit.get("ok") is True,
            "finalAudit": audit,
            "cycles": [],
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
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        self.report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        generated_at: str | None = None,
    ):
        self.runner = CoverageHarvestLoopCommandRunner(
            dictionary_path=dictionary_path,
            state_path=state_path,
            report_path=report_path,
            max_cycles=max_cycles,
            rounds_per_cycle=rounds_per_cycle,
            target_evidence=target_evidence,
            max_actions=max_actions,
            min_coverage_ratio=min_coverage_ratio,
            require_complete=require_complete,
            require_source_backed_evidence=require_source_backed_evidence,
            require_comment_backed_evidence=require_comment_backed_evidence,
            generated_at=generated_at,
        )

    def run(self) -> dict[str, Any]:
        return self.runner.run()


class CoverageHarvestLoopCommandRequest:
    """Argv parser for the file-backed coverage harvest-loop command."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.mock_cycle_payload:
            payload = JsonContractReader().read_value(args.mock_cycle_payload, {})
            payload = payload if isinstance(payload, dict) else {}
            return CoverageHarvestLoopCycleReportBuilder(
                generated_at=payload.get("generatedAt") or args.generated_at or None,
                max_cycles=payload.get("maxCycles", args.max_cycles),
                rounds_per_cycle=payload.get("roundsPerCycle", args.rounds_per_cycle),
            ).build(
                cycle=payload.get("cycle", 1),
                priority_queries=payload.get("priorityQueries") if isinstance(payload.get("priorityQueries"), list) else [],
                harvest=payload.get("harvest") if isinstance(payload.get("harvest"), dict) else {},
                before_audit=payload.get("beforeAudit") if isinstance(payload.get("beforeAudit"), dict) else {},
                after_audit=payload.get("afterAudit") if isinstance(payload.get("afterAudit"), dict) else {},
                stop_reason=str(payload.get("stopReason") or ""),
            )
        return CoverageHarvestLoopRequest(
            dictionary_path=args.dictionary,
            state_path=args.state,
            report_path=args.report,
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
        parser.add_argument("--target-evidence", type=int, default=3)
        parser.add_argument("--max-actions", type=int, default=12)
        parser.add_argument("--min-coverage-ratio", type=float, default=1)
        parser.add_argument("--allow-incomplete", action="store_true")
        parser.add_argument("--require-source-backed-evidence", action="store_true")
        parser.add_argument("--require-comment-backed-evidence", action="store_true")
        parser.add_argument("--generated-at", default="")
        parser.add_argument("--mock-cycle-payload", default="", help="Build a one-cycle report from a JSON payload without live harvesting.")
        parser.add_argument("--exit-zero", action="store_true")
        return parser
