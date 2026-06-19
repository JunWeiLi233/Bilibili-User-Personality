from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.batch_uid_scrape import BatchScraperLauncherPlanner


class BatchScraperLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchAllScrapers.js ranges."""

    def __init__(self, data_dir: str | Path, *, script: str = "server/scripts/batchUidScrape.js"):
        self.data_dir = Path(data_dir)
        self.script = script

    def run(self) -> dict[str, Any]:
        return BatchScraperLauncherPlanner().build_plan(data_dir=self.data_dir, script=self.script)


class BatchScraperLauncherContractComparator:
    """Compare Python batch scraper launch plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("workers", "summary")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = self._contract_summary(BatchScraperLauncherPlanRunner(self.data_dir).run())
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {key: python_result.get(key) for key in self.RESULT_KEYS if key in python_result},
            "js": {key: js_result.get(key) for key in self.RESULT_KEYS if key in js_result},
        }

    def _contract_summary(self, result: dict[str, Any]) -> dict[str, Any]:
        workers = [
            {"start": worker["start"], "end": worker["end"], "progressFile": worker["progressFile"]}
            for worker in result.get("workers", [])
            if isinstance(worker, dict)
        ]
        return {"workers": workers, "summary": result.get("summary")}

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run batch UID scraper launcher plan.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch launcher report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BatchScraperLauncherContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = BatchScraperLauncherPlanRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
