from __future__ import annotations

import argparse
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_harvest_loop_plan import (
    CoverageHarvestLoopCommandCompareCommandRequest,
    CoverageHarvestLoopCommandContractComparator,
    CoverageHarvestLoopCommandReportFileComparator,
    CoverageHarvestLoopCommandSummary,
    CoverageHarvestLoopPlanCommandRequest,
    CoverageHarvestLoopPlanContractComparator,
    CoverageHarvestLoopPlanPayloadContractComparator,
    CoverageHarvestLoopPlanRequest,
    CoverageHarvestLoopPlanRunner,
    CoverageHarvestLoopPlanSummary,
)
from python_backend.analysis.coverage_harvest_loop_command import (
    CoverageHarvestLoopCommandRequest,
    CoverageHarvestLoopCommandRunner,
    CoverageHarvestLoopRequest,
)
from python_backend.analysis.coverage_progress import CoverageProgressTracker
from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder


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


def _float_or(value: Any, fallback: float) -> float:
    try:
        return float(value if value is not None else fallback)
    except (TypeError, ValueError):
        return fallback


def _flag_value(value: Any, fallback: bool = False) -> bool:
    if value is None or value == "":
        return fallback
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _exception_text(error: BaseException) -> str:
    if isinstance(error, subprocess.CalledProcessError):
        stderr = str(error.stderr or "").strip()
        stdout = str(error.stdout or "").strip()
        detail = stderr or stdout or str(error)
        return detail
    return str(error)


def _parse_list(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _parse_many(values: list[Any] | None) -> list[str] | None:
    if values is None:
        return None
    result: list[str] = []
    for value in values:
        result.extend(_parse_list(value))
    return result


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

    def build_many(self, cycles: list[dict[str, Any]] | None = None, *, stop_reason: str = "") -> dict[str, Any]:
        cycle_items = cycles if isinstance(cycles, list) else []
        normalized_cycles = [self._cycle_report(item, index + 1) for index, item in enumerate(cycle_items) if isinstance(item, dict)]
        final_audit = self._audit_from_cycle(cycle_items[-1], "afterAudit") if cycle_items and isinstance(cycle_items[-1], dict) else {}
        return {
            "generatedAt": self.generated_at,
            "maxCycles": self.max_cycles,
            "roundsPerCycle": self.rounds_per_cycle,
            "stopReason": stop_reason or ("coverage_gate_passed" if final_audit.get("ok") is True else ""),
            "finalOk": final_audit.get("ok") is True,
            "finalAudit": final_audit,
            "cycles": normalized_cycles,
        }

    def _cycle_report(self, payload: dict[str, Any], fallback_cycle: int) -> dict[str, Any]:
        before_audit = self._audit_from_cycle(payload, "beforeAudit")
        after_audit = self._audit_from_cycle(payload, "afterAudit")
        before_coverage = before_audit.get("coverage") if isinstance(before_audit.get("coverage"), dict) else {}
        after_coverage = after_audit.get("coverage") if isinstance(after_audit.get("coverage"), dict) else {}
        harvest_summary = self._harvest_summary(payload.get("harvest") if isinstance(payload.get("harvest"), dict) else {})
        return {
            "cycle": _positive_int(payload.get("cycle"), fallback_cycle),
            "priorityQueries": payload.get("priorityQueries") if isinstance(payload.get("priorityQueries"), list) else [],
            "harvest": harvest_summary,
            "coverageDelta": self.progress_tracker.coverage_delta_from_harvest(
                before_coverage,
                after_coverage,
                harvest_summary["coverageProgress"],
            ),
            "coverageBefore": before_coverage,
            "coverageAfter": after_coverage,
        }

    @staticmethod
    def _audit_from_cycle(payload: dict[str, Any], key: str) -> dict[str, Any]:
        audit = payload.get(key) if isinstance(payload, dict) else {}
        return audit if isinstance(audit, dict) else {}

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


