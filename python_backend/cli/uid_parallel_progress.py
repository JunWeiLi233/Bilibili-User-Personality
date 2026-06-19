from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


STAT_KEYS = ("success", "noText", "errors")


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
        processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        assigned_uids = self._assigned_uids(all_comments)
        processed_count = len(processed)
        assigned_count = len(assigned_uids)
        return {
            "ok": True,
            "worker": {"id": self.worker_id, "totalWorkers": self.total_workers, "assigned": assigned_count},
            "progress": {
                "processed": processed_count,
                "remaining": max(0, assigned_count - processed_count),
                "completionRatio": round(processed_count / assigned_count, 4) if assigned_count else 0,
            },
            "stats": {key: int(stats.get(key) or 0) for key in STAT_KEYS},
            "statusCounts": self._status_counts(processed),
            "userDb": self._user_db_summary(assigned_uids),
            "lastUpdated": progress.get("lastUpdated") or None,
        }

    def _assigned_uids(self, all_comments: Any) -> list[str]:
        if not isinstance(all_comments, dict):
            return []
        return [uid for index, uid in enumerate(all_comments.keys()) if index % self.total_workers == self.worker_id]

    def _status_counts(self, processed: dict[str, Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for status in processed.values():
            key = str(status)
            counts[key] = counts.get(key, 0) + 1
        return counts

    def _user_db_summary(self, assigned_uids: list[str]) -> dict[str, int]:
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        assigned_set = set(assigned_uids)
        return {
            "users": len(users),
            "assignedUsersInDb": sum(1 for uid in users if uid in assigned_set),
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidParallelProgressContractComparator:
    """Compare a Python UID parallel progress summary against saved JS-compatible JSON."""

    RESULT_KEYS = ("worker", "progress", "stats", "statusCounts", "userDb")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options

    def compare(self) -> dict[str, Any]:
        python_result = UidParallelProgressRunner(self.data_dir, **self.runner_options).run()
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
