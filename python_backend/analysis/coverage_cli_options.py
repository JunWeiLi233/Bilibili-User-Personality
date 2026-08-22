from __future__ import annotations

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


def _parse_cli_args(argv: list[Any] | None = None) -> dict[str, str]:
    flags: dict[str, str] = {}
    args = argv if isinstance(argv, list) else []
    index = 0
    while index < len(args):
        raw = str(args[index] or "").strip()
        if not raw.startswith("--"):
            index += 1
            continue
        without_prefix = raw[2:]
        equals_index = without_prefix.find("=")
        if equals_index >= 0:
            flags[without_prefix[:equals_index]] = without_prefix[equals_index + 1 :]
            index += 1
            continue
        if index + 1 < len(args):
            next_val = str(args[index + 1] or "").strip()
            if next_val and not next_val.startswith("--"):
                flags[without_prefix] = next_val
                index += 2
                continue
        flags[without_prefix] = "1"
        index += 1
    return flags


def _option_value(flags: dict[str, str], env: dict[str, str], cli_name: str, env_name: str, fallback: Any) -> Any:
    if cli_name in flags:
        return flags[cli_name]
    return env.get(env_name, fallback)


def build_coverage_runtime_options(
    argv: list[str] | None = None,
    env: dict[str, str] | None = None,
    max_actions_fallback: int = 20,
) -> dict[str, Any]:
    flags = _parse_cli_args(argv)
    env = env if isinstance(env, dict) else {}

    require_comment_backed_evidence = (
        _flag_value(flags.get("strict-comment-backed"), False)
        or _flag_value(flags.get("require-comments"), False)
        or env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS") == "1"
    )
    require_source_backed_evidence = (
        require_comment_backed_evidence
        or _flag_value(flags.get("require-sources"), False)
        or env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES") == "1"
        or env.get("BILIBILI_HARVEST_REQUIRE_SOURCES") == "1"
    )
    retry_fallback = 1 if require_comment_backed_evidence else 3

    return {
        "targetEvidence": _positive_int(
            _option_value(flags, env, "target-evidence", "BILIBILI_HARVEST_TARGET_EVIDENCE", 3), 3, 1000
        ),
        "maxActions": _positive_int(
            _option_value(flags, env, "max-actions", "BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS", max_actions_fallback),
            max_actions_fallback,
            1000,
        ),
        "minCoverageRatio": _number_value(
            _option_value(flags, env, "min-ratio", "BILIBILI_COVERAGE_AUDIT_MIN_RATIO", 1), 1
        ),
        "requireComplete": False if "no-require-complete" in flags else env.get("BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE") != "0",
        "requireSourceBackedEvidence": require_source_backed_evidence,
        "requireCommentBackedEvidence": require_comment_backed_evidence,
        "prioritizeSourceGaps": require_comment_backed_evidence,
        "retryBeforeUnattemptedLimit": _non_negative_int(
            _option_value(
                flags, env, "retry-before-unattempted", "BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT", retry_fallback
            ),
            retry_fallback,
            20,
        ),
        "strict": _flag_value(flags.get("strict"), False)
        or env.get("BILIBILI_COVERAGE_AUDIT_STRICT") == "1"
        or env.get("BILIBILI_COVERAGE_LOOP_STRICT") == "1",
    }
