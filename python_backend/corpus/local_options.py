from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import safe_read_json_object


DEFAULT_CORPUS_PATHS = [
    "server/data/uid-discovery-comments.json",
    "server/data/bilibiliDirectProbeCorpus.json",
    "server/data/tiebaKeywordCorpus.json",
    "server/data/huggingFaceKeywordCorpus.json",
]
DEFAULT_COVERAGE_ACTION_FILE_PATH = "server/data/coverage-actions.json"


class LocalCorpusMinePlanSummary:
    """Shape local corpus mining option plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("options",)

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


def parse_corpus_paths(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _js_number_or_default(value: Any, fallback: int) -> int:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return fallback
    return int(number) if number else fallback


def _bounded(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    number = _js_number_or_default(value, fallback)
    return max(minimum, min(number, maximum))


class LocalCorpusMineOptionsPlanner:
    """Build mineLocalCorpusEvidence.js-compatible option contracts."""

    def build_plan(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"ok": True, "options": self.build_options(argv=argv, env=env)}

    def build_options(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        env = env or {}
        env_corpus_paths = parse_corpus_paths(env.get("LOCAL_BILIBILI_CORPUS_PATH"))
        options: dict[str, Any] = {
            "corpusPaths": env_corpus_paths if env_corpus_paths else list(DEFAULT_CORPUS_PATHS),
            "targetEvidence": _js_number_or_default(env.get("BILIBILI_COVERAGE_TARGET_EVIDENCE") or 3, 3),
            "maxSamplesPerTerm": _js_number_or_default(env.get("LOCAL_CORPUS_MAX_SAMPLES_PER_TERM") or 3, 3),
            "actionFile": env.get("LOCAL_CORPUS_ACTION_FILE") or DEFAULT_COVERAGE_ACTION_FILE_PATH,
            "requireCommentBackedEvidence": env.get("LOCAL_CORPUS_REQUIRE_COMMENT_BACKED") != "0",
            "write": env.get("LOCAL_CORPUS_WRITE") == "1",
        }
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--corpus="):
                options["corpusPaths"] = parse_corpus_paths(arg[len("--corpus=") :])
            elif arg.startswith("--actions="):
                options["actionFile"] = arg[len("--actions=") :].strip()
            elif arg.startswith("--target-evidence="):
                options["targetEvidence"] = _js_number_or_default(arg[len("--target-evidence=") :], 3)
            elif arg.startswith("--max-samples-per-term="):
                options["maxSamplesPerTerm"] = _js_number_or_default(arg[len("--max-samples-per-term=") :], 3)
            elif arg == "--no-comment-backed":
                options["requireCommentBackedEvidence"] = False
            elif arg == "--write":
                options["write"] = True
        options["targetEvidence"] = _bounded(options["targetEvidence"], 3, 1, 20)
        options["maxSamplesPerTerm"] = _bounded(options["maxSamplesPerTerm"], 3, 1, 20)
        return options


class LocalCorpusMinePlanRunner:
    """Read a JS-compatible local corpus mining payload and emit parsed options."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = LocalCorpusMineOptionsPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class LocalCorpusMinePlanContractComparator:
    """Compare Python local-corpus mine plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = LocalCorpusMinePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = LocalCorpusMinePlanRunner(self.payload_path).run()
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


class LocalCorpusMinePlanRequest:
    """Corpus-layer request for local corpus mining option-plan JSON commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return LocalCorpusMinePlanContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return LocalCorpusMinePlanRunner(self.payload_path).run()


class LocalCorpusMinePlanCommandRequest:
    """Parse CLI argv for local corpus mine plans while keeping ownership in corpus."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a mineLocalCorpusEvidence.js-compatible dry-run option plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local-corpus mine option report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return LocalCorpusMinePlanRequest(
            args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()
