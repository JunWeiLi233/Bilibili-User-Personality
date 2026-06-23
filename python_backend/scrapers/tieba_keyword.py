from __future__ import annotations

import argparse
import math
import re
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object
from python_backend.scrapers.rate_limiter import RateLimitPolicy


DEFAULT_COVERAGE_ACTION_FILE_NAME = "keywordCoverageActions.json"
DEFAULT_TIEBA_CORPUS_FILE_NAME = "tiebaKeywordCorpus.json"


def _js_number(value: Any) -> float:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return math.nan
    return number if math.isfinite(number) else math.nan


def _number_or(value: Any, fallback: float) -> float:
    number = _js_number(value)
    return number if math.isfinite(number) and number else fallback


def _bounded_number(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    number = _js_number(value)
    if not math.isfinite(number):
        return fallback
    return int(max(minimum, min(number, maximum)))


def _bounded_positive(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    return int(max(minimum, min(_number_or(value, fallback), maximum)))


def _split_list(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[,;|]", str(value or "")) if item.strip()]


def _unique(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


class TiebaKeywordPlanSummary:
    """Shape Tieba keyword scrape option plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("options",)

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class TiebaKeywordScrapeOptionsPlanner:
    """Build runTiebaKeywordScrape.js-compatible dry-run options."""

    def __init__(self, cwd: str | Path | None = None):
        self.cwd = Path(cwd) if cwd is not None else Path.cwd()

    def _data_path(self, file_name: str) -> str:
        return str(self.cwd / "server" / "data" / file_name)

    def build_options(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        env = env or {}
        options: dict[str, Any] = {
            "queries": [],
            "threadUrls": [],
            "actionFile": self._data_path(DEFAULT_COVERAGE_ACTION_FILE_NAME),
            "outputPath": env.get("TIEBA_CORPUS_PATH") or self._data_path(DEFAULT_TIEBA_CORPUS_FILE_NAME),
            "maxQueries": _js_number(env.get("TIEBA_MAX_QUERIES") or 8),
            "forumPages": _js_number(env.get("TIEBA_FORUM_PAGES") or 1),
            "threadLimit": _js_number(env.get("TIEBA_THREAD_LIMIT") or 4),
            "threadPages": _js_number(env.get("TIEBA_THREAD_PAGES") or 1),
            "minDelayMs": _js_number(env.get("TIEBA_SCRAPER_MIN_DELAY_MS") or 5000),
            "jitterMs": _js_number(env.get("TIEBA_SCRAPER_JITTER_MS") or 3000),
            "blockCooldownMs": _js_number(env.get("TIEBA_SCRAPER_BLOCK_COOLDOWN_MS") or 120000),
            "requestTimeoutMs": _js_number(env.get("TIEBA_SCRAPER_REQUEST_TIMEOUT_MS") or 15000),
            "overallTimeoutMs": _js_number(env.get("TIEBA_SCRAPER_OVERALL_TIMEOUT_MS") or 30000),
            "discoveryMode": env.get("TIEBA_DISCOVERY_MODE") or "desktop",
            "includeDiscoveryTitles": env.get("TIEBA_INCLUDE_DISCOVERY_TITLES") == "1",
            "discoveryTitlesOnly": env.get("TIEBA_DISCOVERY_TITLES_ONLY") == "1",
            "train": env.get("TIEBA_TRAIN_DICTIONARY") == "1",
            "existingTermsOnly": env.get("TIEBA_EXISTING_TERMS_ONLY") != "0",
        }

        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--query="):
                options["queries"].append(arg[len("--query=") :].strip())
            elif arg.startswith("--queries="):
                options["queries"].extend(_split_list(arg[len("--queries=") :]))
            elif arg.startswith("--thread-url="):
                options["threadUrls"].append(arg[len("--thread-url=") :].strip())
            elif arg.startswith("--thread-urls="):
                options["threadUrls"].extend(_split_list(arg[len("--thread-urls=") :]))
            elif arg.startswith("--actions="):
                options["actionFile"] = arg[len("--actions=") :].strip()
            elif arg.startswith("--output="):
                options["outputPath"] = arg[len("--output=") :].strip()
            elif arg.startswith("--max-queries="):
                options["maxQueries"] = _js_number(arg[len("--max-queries=") :])
            elif arg.startswith("--forum-pages="):
                options["forumPages"] = _js_number(arg[len("--forum-pages=") :])
            elif arg.startswith("--thread-limit="):
                options["threadLimit"] = _js_number(arg[len("--thread-limit=") :])
            elif arg.startswith("--thread-pages="):
                options["threadPages"] = _js_number(arg[len("--thread-pages=") :])
            elif arg.startswith("--min-delay-ms="):
                options["minDelayMs"] = _js_number(arg[len("--min-delay-ms=") :])
            elif arg.startswith("--jitter-ms="):
                options["jitterMs"] = _js_number(arg[len("--jitter-ms=") :])
            elif arg.startswith("--block-cooldown-ms="):
                options["blockCooldownMs"] = _js_number(arg[len("--block-cooldown-ms=") :])
            elif arg.startswith("--request-timeout-ms="):
                options["requestTimeoutMs"] = _js_number(arg[len("--request-timeout-ms=") :])
            elif arg.startswith("--overall-timeout-ms="):
                options["overallTimeoutMs"] = _js_number(arg[len("--overall-timeout-ms=") :])
            elif arg.startswith("--discovery-mode="):
                options["discoveryMode"] = arg[len("--discovery-mode=") :].strip()
            elif arg == "--include-discovery-titles":
                options["includeDiscoveryTitles"] = True
            elif arg == "--discovery-titles-only":
                options["discoveryTitlesOnly"] = True
                options["includeDiscoveryTitles"] = True
            elif arg == "--train":
                options["train"] = True
            elif arg == "--new-terms":
                options["existingTermsOnly"] = False
            elif arg and not arg.startswith("--"):
                options["queries"].append(arg.strip())

        options["queries"] = _unique([str(item).strip() for item in options["queries"]])
        options["threadUrls"] = _unique([str(item).strip() for item in options["threadUrls"]])
        options["maxQueries"] = _bounded_positive(options["maxQueries"], 8, 1, 50)
        options["forumPages"] = _bounded_positive(options["forumPages"], 1, 1, 10)
        options["threadLimit"] = _bounded_positive(options["threadLimit"], 4, 1, 50)
        options["threadPages"] = _bounded_positive(options["threadPages"], 1, 1, 10)
        options.update(
            RateLimitPolicy(
                min_delay_ms=options["minDelayMs"],
                jitter_ms=options["jitterMs"],
                block_cooldown_ms=options["blockCooldownMs"],
            ).to_tieba_options()
        )
        options["requestTimeoutMs"] = _bounded_positive(options["requestTimeoutMs"], 15000, 1000, 60000)
        options["overallTimeoutMs"] = _bounded_positive(options["overallTimeoutMs"], 30000, 1000, 120000)
        discovery_mode = str(options["discoveryMode"]).lower()
        options["discoveryMode"] = discovery_mode if discovery_mode in {"desktop", "mobile"} else "desktop"
        return options


class TiebaKeywordPlanRunner:
    """Read a JS-compatible Tieba scrape payload and emit parsed options."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        options = TiebaKeywordScrapeOptionsPlanner(cwd=payload.get("cwd") if payload.get("cwd") else None).build_options(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )
        return {"ok": True, "options": options}

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class TiebaKeywordPlanContractComparator:
    """Compare Python Tieba scrape plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = TiebaKeywordPlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = TiebaKeywordPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
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

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class TiebaKeywordPlanRequest:
    """Scraper-layer request for Tieba keyword plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return TiebaKeywordPlanContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return TiebaKeywordPlanRunner(self.payload_path).run()


class TiebaKeywordPlanCommandRequest:
    """Argv-backed scraper-layer request for Tieba keyword plan contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a runTiebaKeywordScrape.js-compatible dry-run option plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba option report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return TiebaKeywordPlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()
