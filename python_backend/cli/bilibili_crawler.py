from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerHelper, BilibiliCrawlerSummary


class BilibiliCrawlerRunner:
    """Run deterministic Bilibili crawler helper functions from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.helper = BilibiliCrawlerHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.helper.run_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliCrawlerContractComparator:
    """Compare Python Bilibili crawler helper output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliCrawlerSummary()

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliCrawlerRunner(self.payload_path).run()
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
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Bilibili crawler helper functions from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to crawler helper payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible crawler helper report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BilibiliCrawlerContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = BilibiliCrawlerRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
