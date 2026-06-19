from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


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


def _number_value(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _flag_value(value: Any, fallback: bool = False) -> bool:
    if value is None or value == "":
        return fallback
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_list(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


class VideoKeywordDiscoveryOptionsBuilder:
    """Build keyword-harvest discovery options from JSON-provided env and argv values."""

    def __init__(self, cwd: str | Path | None = None):
        self.cwd = Path(cwd) if cwd is not None else Path.cwd()

    def parse_priority_query_content(self, value: Any) -> list[Any]:
        content = str(value or "").strip()
        if not content:
            return []
        try:
            parsed = json.loads(content)
            items = parsed if isinstance(parsed, list) else [parsed]
            normalized = [self._normalize_priority_query_item(item) for item in items]
            normalized = [item for item in normalized if item]
            if normalized:
                return normalized
        except json.JSONDecodeError:
            pass

        lines = [item.strip() for item in re.split(r"[\r\n]+", content) if item.strip()]
        if lines and all(line.startswith("{") for line in lines):
            result: list[Any] = []
            for line in lines:
                try:
                    result.append(self._normalize_priority_query_item(json.loads(line)) or line)
                except json.JSONDecodeError:
                    result.append(line)
            return result
        return _parse_list(content)

    def build(
        self,
        env: dict[str, Any] | None = None,
        argv: list[Any] | None = None,
        priority_queries: list[Any] | None = None,
        seed_queries: list[Any] | None = None,
        controversy_queries: list[Any] | None = None,
        extra_query_templates: list[Any] | None = None,
        exhausted_suggestion_templates: list[Any] | None = None,
    ) -> dict[str, Any]:
        env = self._env_with_cli_flags(env or {}, argv or [])
        priority_queries = priority_queries if isinstance(priority_queries, list) else []
        seed_queries = seed_queries if isinstance(seed_queries, list) else []
        controversy_queries = controversy_queries if isinstance(controversy_queries, list) else []
        extra_query_templates = extra_query_templates if isinstance(extra_query_templates, list) else []
        exhausted_suggestion_templates = exhausted_suggestion_templates if isinstance(exhausted_suggestion_templates, list) else []
        max_queries = _positive_int(env.get("BILIBILI_HARVEST_MAX_QUERIES"), len(seed_queries) or 12)
        require_comment_backed = env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS") == "1"
        require_source_backed = (
            require_comment_backed
            or env.get("BILIBILI_HARVEST_REQUIRE_SOURCES") == "1"
            or env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES") == "1"
        )
        retry_fallback = 1 if require_comment_backed else 3
        data_dir = self.cwd / "server" / "data"
        return {
            "priorityQueries": priority_queries,
            "seedQueries": seed_queries,
            "controversyQueries": controversy_queries,
            "maxQueries": max_queries,
            "termsPerFamily": _positive_int(env.get("BILIBILI_HARVEST_TERMS_PER_FAMILY"), 4),
            "queryVariantsPerTerm": _positive_int(env.get("BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM"), 2),
            "retryBeforeUnattemptedLimit": _non_negative_int(env.get("BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT"), retry_fallback),
            "staleMissedDiscoveryLimit": _non_negative_int(env.get("BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT"), 4),
            "staleMissedPages": _non_negative_int(env.get("BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES"), 3),
            "extraQueryTemplates": extra_query_templates,
            "exhaustedSuggestionTemplates": exhausted_suggestion_templates,
            "targetEvidence": _positive_int(env.get("BILIBILI_HARVEST_TARGET_EVIDENCE"), 3),
            "coverageMode": str(env.get("BILIBILI_HARVEST_COVERAGE_MODE") or "all-weak").strip().lower(),
            "requireSourceBackedEvidence": require_source_backed,
            "requireCommentBackedEvidence": require_comment_backed,
            "prioritizeSourceGaps": require_comment_backed,
            "existingTermsOnly": env.get("BILIBILI_HARVEST_EXISTING_TERMS_ONLY") == "1",
            "discoveryMode": str(env.get("BILIBILI_VIDEO_DISCOVERY_MODE") or "controversial").strip().lower(),
            "discoveryLimit": _positive_int(env.get("BILIBILI_VIDEO_DISCOVERY_LIMIT"), 6),
            "controversialPopularQueryLimit": _non_negative_int(env.get("BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT"), 4),
            "controversialPopularSearchOrder": str(env.get("BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER") or "click").strip().lower(),
            "includeGenericPopular": _flag_value(env.get("BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR"), False),
            "includeDanmaku": _flag_value(env.get("BILIBILI_HARVEST_INCLUDE_DANMAKU"), False),
            "pages": _positive_int(env.get("BILIBILI_VIDEO_COMMENT_PAGES"), 2),
            "perQueryTimeoutMs": _positive_int(env.get("BILIBILI_HARVEST_QUERY_TIMEOUT_MS"), 180000),
            "expandTargetsFromComments": _flag_value(env.get("BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS"), False),
            "includeHistoryTags": _flag_value(env.get("BILIBILI_HARVEST_INCLUDE_HISTORY_TAGS"), False),
            "historyTagCorpusPath": env.get("BILIBILI_HISTORY_TAG_CORPUS_PATH") or "server/data/bilibiliHistoryTagCorpus.json",
            "historyTagVideoLimit": _positive_int(env.get("BILIBILI_HISTORY_TAG_VIDEO_LIMIT"), 20),
            "rounds": _positive_int(env.get("BILIBILI_HARVEST_ROUNDS"), 1),
            "statePath": env.get("BILIBILI_HARVEST_STATE_PATH") or str(data_dir / "keywordHarvestState.json"),
            "reportPath": env.get("BILIBILI_HARVEST_REPORT_PATH") or str(data_dir / "keywordHarvestReport.json"),
            "lockPath": env.get("BILIBILI_HARVEST_LOCK_PATH") or str(data_dir / ".keyword-harvest.lock"),
            "lockStaleMs": _positive_int(env.get("BILIBILI_HARVEST_LOCK_STALE_MS"), 6 * 60 * 60 * 1000),
            "resetState": env.get("BILIBILI_HARVEST_RESET") == "1",
            "skipSeen": env.get("BILIBILI_HARVEST_SKIP_SEEN") != "0",
        }

    def _normalize_priority_query_item(self, item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        query = str(item.get("query") or item.get("nextQuery") or "").strip()
        next_query = str(item.get("nextQuery") or item.get("query") or "").strip()
        term = str(item.get("term") or "").strip()
        if not query and not next_query:
            return None
        normalized = dict(item)
        if term:
            normalized["term"] = term
        elif "term" in normalized:
            normalized.pop("term")
        normalized["query"] = query or next_query
        normalized["nextQuery"] = next_query or query
        return normalized

    def _env_with_cli_flags(self, env: dict[str, Any], argv: list[Any]) -> dict[str, Any]:
        result = dict(env)
        for raw in argv:
            arg = str(raw or "")
            if arg == "--include-history-tags":
                result["BILIBILI_HARVEST_INCLUDE_HISTORY_TAGS"] = "1"
            elif arg == "--no-history-tags":
                result["BILIBILI_HARVEST_INCLUDE_HISTORY_TAGS"] = "0"
            elif arg.startswith("--history-tag-corpus="):
                result["BILIBILI_HISTORY_TAG_CORPUS_PATH"] = arg[len("--history-tag-corpus=") :].strip()
            elif arg.startswith("--history-tag-limit="):
                result["BILIBILI_HISTORY_TAG_VIDEO_LIMIT"] = arg[len("--history-tag-limit=") :].strip()
        return result


class CoverageRuntimeOptionsBuilder:
    """Build coverage audit runtime options with JS-compatible CLI/env precedence."""

    def build(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None, max_actions_fallback: int = 20) -> dict[str, Any]:
        env = env or {}
        flags = self._parse_cli_args(argv or [])
        require_comment_backed = (
            _flag_value(flags.get("strict-comment-backed"), False)
            or _flag_value(flags.get("require-comments"), False)
            or env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS") == "1"
        )
        require_source_backed = (
            require_comment_backed
            or _flag_value(flags.get("require-sources"), False)
            or env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES") == "1"
            or env.get("BILIBILI_HARVEST_REQUIRE_SOURCES") == "1"
        )
        retry_fallback = 1 if require_comment_backed else 3
        return {
            "targetEvidence": _positive_int(self._option_value(flags, env, "target-evidence", "BILIBILI_HARVEST_TARGET_EVIDENCE", 3), 3, 1000),
            "maxActions": _positive_int(self._option_value(flags, env, "max-actions", "BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS", max_actions_fallback), max_actions_fallback, 1000),
            "minCoverageRatio": _number_value(self._option_value(flags, env, "min-ratio", "BILIBILI_COVERAGE_AUDIT_MIN_RATIO", 1), 1),
            "requireComplete": False if "no-require-complete" in flags else env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE") != "0",
            "requireSourceBackedEvidence": require_source_backed,
            "requireCommentBackedEvidence": require_comment_backed,
            "prioritizeSourceGaps": require_comment_backed,
            "retryBeforeUnattemptedLimit": _non_negative_int(
                self._option_value(flags, env, "retry-before-unattempted", "BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT", retry_fallback),
                retry_fallback,
                20,
            ),
            "strict": _flag_value(flags.get("strict"), False) or env.get("BILIBILI_COVERAGE_AUDIT_STRICT") == "1" or env.get("BILIBILI_COVERAGE_LOOP_STRICT") == "1",
        }

    def _parse_cli_args(self, argv: list[Any]) -> dict[str, str]:
        flags: dict[str, str] = {}
        index = 0
        while index < len(argv):
            raw = str(argv[index] or "").strip()
            if not raw.startswith("--"):
                index += 1
                continue
            without_prefix = raw[2:]
            if "=" in without_prefix:
                name, value = without_prefix.split("=", 1)
                flags[name] = value
                index += 1
                continue
            next_value = str(argv[index + 1] or "").strip() if index + 1 < len(argv) else ""
            if next_value and not next_value.startswith("--"):
                flags[without_prefix] = next_value
                index += 2
            else:
                flags[without_prefix] = "1"
                index += 1
        return flags

    def _option_value(self, flags: dict[str, str], env: dict[str, Any], cli_name: str, env_name: str, fallback: Any) -> Any:
        return flags[cli_name] if cli_name in flags else env.get(env_name, fallback)
