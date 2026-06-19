from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder, VideoKeywordDiscoveryOptionsBuilder


class HarvestOptionsRunner:
    """Build harvest-related option objects from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "video-keyword").strip().lower()
        if mode == "coverage-runtime":
            options = CoverageRuntimeOptionsBuilder().build(
                argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
                env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
                max_actions_fallback=int(payload.get("maxActionsFallback") or 20),
            )
            return {"ok": True, "mode": mode, "options": options}
        builder = VideoKeywordDiscoveryOptionsBuilder(cwd=payload.get("cwd") if payload.get("cwd") else None)
        if mode == "priority-query-content":
            return {
                "ok": True,
                "mode": mode,
                "priorityQueries": builder.parse_priority_query_content(payload.get("content")),
            }
        options = builder.build(
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            priority_queries=payload.get("priorityQueries") if isinstance(payload.get("priorityQueries"), list) else [],
            seed_queries=payload.get("seedQueries") if isinstance(payload.get("seedQueries"), list) else [],
            controversy_queries=payload.get("controversyQueries") if isinstance(payload.get("controversyQueries"), list) else [],
            extra_query_templates=payload.get("extraQueryTemplates") if isinstance(payload.get("extraQueryTemplates"), list) else [],
            exhausted_suggestion_templates=payload.get("exhaustedSuggestionTemplates") if isinstance(payload.get("exhaustedSuggestionTemplates"), list) else [],
        )
        return {"ok": True, "mode": "video-keyword", "options": options}

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class HarvestOptionsContractComparator:
    """Compare Python harvest option outputs against saved JS-compatible JSON."""

    RESULT_KEYS = ("mode", "options", "priorityQueries")

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = HarvestOptionsRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build harvest option objects from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to harvest options payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible harvest options report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = HarvestOptionsContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = HarvestOptionsRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
