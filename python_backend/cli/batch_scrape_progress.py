from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.aicu import AicuBatchProgressReporter, AicuBatchProgressSummary


class BatchScrapeProgressRunner:
    """Summarize legacy batch scrape progress JSON without mutating scraper state."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        progress_file: str = "batch-scrape-progress.json",
        database_file: str = "aicu-user-database.json",
        mode: str = "uid-range",
        start_uid: int = 100000,
        end_uid: int = 200000,
        pages: int = 50,
    ):
        self.data_dir = Path(data_dir)
        self.progress_path = self.data_dir / progress_file
        self.database_path = self.data_dir / database_file
        self.mode = mode
        self.start_uid = int(start_uid)
        self.end_uid = int(end_uid)
        self.pages = int(pages)

    def run(self) -> dict[str, Any]:
        progress = self._read_json(self.progress_path, {})
        database = self._read_json(self.database_path, {})
        reporter = AicuBatchProgressReporter(
            mode=self.mode,
            progress_file=self.progress_path.name,
            start_uid=self.start_uid,
            end_uid=self.end_uid,
            pages=self.pages,
        )
        return reporter.build_report(progress, database)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class BatchScrapeProgressContractComparator:
    """Compare Python legacy batch scrape progress reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("mode", "progress", "database", "timestamps")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options
        self.summary = AicuBatchProgressSummary()

    def compare(self) -> dict[str, Any]:
        python_result = BatchScrapeProgressRunner(self.data_dir, **self.runner_options).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
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
    parser = argparse.ArgumentParser(description="Summarize legacy batch scrape progress JSON.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--progress-file", default="batch-scrape-progress.json")
    parser.add_argument("--database-file", default="aicu-user-database.json")
    parser.add_argument("--mode", choices=("uid-range", "popular"), default="uid-range")
    parser.add_argument("--start-uid", type=int, default=100000)
    parser.add_argument("--end-uid", type=int, default=200000)
    parser.add_argument("--pages", type=int, default=50)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch scrape progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    runner_options = {
        "progress_file": args.progress_file,
        "database_file": args.database_file,
        "mode": args.mode,
        "start_uid": args.start_uid,
        "end_uid": args.end_uid,
        "pages": args.pages,
    }
    if args.compare_js_report:
        result = BatchScrapeProgressContractComparator(args.data_dir, args.compare_js_report, **runner_options).compare()
    else:
        result = BatchScrapeProgressRunner(args.data_dir, **runner_options).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
