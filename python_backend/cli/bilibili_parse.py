from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.bilibili import BilibiliParseContractComparator as BilibiliParsePayloadComparator, BilibiliParseSummary, BilibiliPublicParser


class BilibiliParseRunner:
    """Parse stored Bilibili payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = BilibiliPublicParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.parser.parse_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliParseContractComparator:
    """Compare Python Bilibili parser output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliParseSummary()
        self.comparator = BilibiliParsePayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliParseRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Bilibili public payloads into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili parser report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BilibiliParseContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = BilibiliParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
