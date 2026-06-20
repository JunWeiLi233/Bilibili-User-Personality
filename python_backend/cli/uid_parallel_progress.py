from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.uid_parallel import UidParallelProgressReporter, UidParallelProgressSummary


class UidParallelProgressRunner:
    """Summarize one uidParallelAnalyzer.js worker progress JSON file."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        worker_id: int = 0,
        total_workers: int = 4,
        comments_file: str = "uid-discovery-comments.json",
        user_db_file: str = "scraped-users-db.json",
    ):
        self.data_dir = Path(data_dir)
        self.worker_id = int(worker_id)
        self.total_workers = max(1, int(total_workers))
        self.comments_path = self.data_dir / comments_file
        self.user_db_path = self.data_dir / user_db_file
        self.progress_path = self.data_dir / f"uid-parallel-{self.worker_id}-progress.json"

    def run(self) -> dict[str, Any]:
        all_comments = self._read_json(self.comments_path, {})
        progress = self._read_json(self.progress_path, {})
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        reporter = UidParallelProgressReporter(worker_id=self.worker_id, total_workers=self.total_workers)
        return reporter.build_report(all_comments, progress, users)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidParallelProgressContractComparator:
    """Compare a Python UID parallel progress summary against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options
        self.summary = UidParallelProgressSummary()

    def compare(self) -> dict[str, Any]:
        python_result = UidParallelProgressRunner(self.data_dir, **self.runner_options).run()
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
    parser = argparse.ArgumentParser(description="Summarize one UID parallel analyzer worker progress JSON file.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--worker", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID parallel progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    runner_options = {"worker_id": args.worker, "total_workers": args.workers}
    if args.compare_js_report:
        result = UidParallelProgressContractComparator(args.data_dir, args.compare_js_report, **runner_options).compare()
    else:
        result = UidParallelProgressRunner(args.data_dir, **runner_options).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
