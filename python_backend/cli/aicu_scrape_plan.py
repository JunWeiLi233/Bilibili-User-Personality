from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.aicu import AicuScrapePlanSummary, AicuScrapePlanner


class AicuScrapePlanRunner:
    """Read a JS-compatible AICU scrape payload and emit a dry-run request plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        argv = payload.get("argv") if isinstance(payload.get("argv"), list) else []
        max_pages = int(payload.get("maxPages") or payload.get("max_pages") or 10)
        page_size = int(payload.get("pageSize") or payload.get("page_size") or 20)
        delay_between_uids_ms = int(payload.get("delayBetweenUidsMs") or payload.get("delay_between_uids_ms") or 15000)
        return AicuScrapePlanner(max_pages=max_pages, page_size=page_size, delay_between_uids_ms=delay_between_uids_ms).build_plan(
            [str(item) for item in argv],
            max_pages=max_pages,
        )

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("AICU scrape plan payload must be a JSON object.")
        return payload


class AicuScrapePlanContractComparator:
    """Compare Python AICU scrape plans against saved JS-compatible reports."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = AicuScrapePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = AicuScrapePlanRunner(self.payload_path).run()
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
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a Python AICU scrape dry-run plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible AICU scrape plan report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = AicuScrapePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = AicuScrapePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
