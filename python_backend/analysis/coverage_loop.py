from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

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
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
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
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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
