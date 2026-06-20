from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.tieba_html import TiebaHtmlParseContractComparator as TiebaHtmlParsePayloadComparator, TiebaHtmlParseSummary, TiebaHtmlParser


class TiebaHtmlParseRunner:
    """Parse stored Tieba HTML payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = TiebaHtmlParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.parser.parse_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaHtmlParseContractComparator:
    """Compare Python Tieba HTML parse output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = TiebaHtmlParseSummary()
        self.comparator = TiebaHtmlParsePayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = TiebaHtmlParseRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Tieba HTML into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode/html/thread fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba HTML parse report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = TiebaHtmlParseContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = TiebaHtmlParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
