from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.batch_uid_range import UidRangeProgressContractComparator as UidRangeProgressPayloadComparator, UidRangeProgressReporter, UidRangeProgressSummary


class UidRangeProgressRunner:
    """Summarize batchUidRange.js progress JSON without mutating scraper state."""

    def __init__(self, progress_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.start = int(start)
        self.end = int(end)

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        return UidRangeProgressReporter(start=self.start, end=self.end).build_report(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidRangeProgressContractComparator:
    """Compare Python UID range progress reports against saved JS-compatible JSON."""

    def __init__(self, progress_path: str | Path, js_report_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)
        self.start = start
        self.end = end
        self.summary = UidRangeProgressSummary()
        self.comparator = UidRangeProgressPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidRangeProgressRunner(self.progress_path, start=self.start, end=self.end).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize batch UID range progress JSON.")
    parser.add_argument("--progress", default="server/data/batch-uid-range-progress.json")
    parser.add_argument("--start", type=int, default=200000)
    parser.add_argument("--end", type=int, default=300000)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID range report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidRangeProgressContractComparator(args.progress, args.compare_js_report, start=args.start, end=args.end).compare()
    else:
        result = UidRangeProgressRunner(args.progress, start=args.start, end=args.end).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
