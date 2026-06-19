from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


STAT_KEYS = ("success", "noComments", "noVideos", "noUser", "trainError", "blocked", "errors")


class UidPipelineProgressRunner:
    """Summarize one uidPipelineWorker.js progress JSON file without mutating it."""

    def __init__(
        self,
        progress_path: str | Path,
        *,
        start: int | None = None,
        end: int | None = None,
        user_db_path: str | Path | None = None,
    ):
        self.progress_path = Path(progress_path)
        inferred_start, inferred_end = self._infer_range(self.progress_path.name)
        self.start = int(start if start is not None else inferred_start)
        self.end = int(end if end is not None else inferred_end)
        self.user_db_path = Path(user_db_path) if user_db_path else self.progress_path.with_name("scraped-users-db.json")

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        processed = payload.get("processed") if isinstance(payload.get("processed"), dict) else {}
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        total = max(0, self.end - self.start + 1)
        processed_count = len(processed)
        normalized_stats = {key: int(stats.get(key) or 0) for key in STAT_KEYS}
        return {
            "ok": True,
            "range": {"start": self.start, "end": self.end, "total": total},
            "progress": {
                "processed": processed_count,
                "remaining": max(0, total - processed_count),
                "completionRatio": round(processed_count / total, 4) if total else 0,
            },
            "stats": normalized_stats,
            "statusCounts": self._status_counts(processed),
            "userDb": self._user_db_summary(),
            "lastUpdated": payload.get("lastUpdated") or None,
        }

    def _status_counts(self, processed: dict[str, Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for status in processed.values():
            key = str(status)
            counts[key] = counts.get(key, 0) + 1
        return counts

    def _user_db_summary(self) -> dict[str, int]:
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        users_in_range = 0
        for uid in users:
            try:
                numeric_uid = int(uid)
            except (TypeError, ValueError):
                continue
            if self.start <= numeric_uid <= self.end:
                users_in_range += 1
        return {"users": len(users), "usersInRange": users_in_range}

    def _infer_range(self, name: str) -> tuple[int, int]:
        match = re.search(r"uid-pipeline-(\d+)-(\d+)\.json$", name)
        if not match:
            return 0, 0
        return int(match.group(1)), int(match.group(2))

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidPipelineProgressContractComparator:
    """Compare one Python UID pipeline progress summary against saved JS-compatible JSON."""

    RESULT_KEYS = ("range", "progress", "stats", "statusCounts", "userDb")

    def __init__(self, progress_path: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineProgressRunner(self.progress_path, **self.runner_options).run()
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
    parser = argparse.ArgumentParser(description="Summarize one UID pipeline worker progress JSON file.")
    parser.add_argument("--progress", default="server/data/uid-pipeline-1-100000.json")
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument("--user-db", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID pipeline progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    runner_options = {"start": args.start, "end": args.end}
    if args.user_db:
        runner_options["user_db_path"] = args.user_db
    if args.compare_js_report:
        result = UidPipelineProgressContractComparator(args.progress, args.compare_js_report, **runner_options).compare()
    else:
        result = UidPipelineProgressRunner(args.progress, **runner_options).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
