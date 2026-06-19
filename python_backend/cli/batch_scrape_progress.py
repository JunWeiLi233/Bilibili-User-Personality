from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


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
        if not isinstance(progress, dict):
            progress = {}
        return {
            "ok": True,
            "mode": self.mode,
            "progressFile": self.progress_path.name,
            "progress": self._progress_summary(progress),
            "database": self._database_summary(database),
            "timestamps": {
                "startTime": progress.get("startTime") or None,
                "endTime": progress.get("endTime") or None,
                "lastUpdated": database.get("lastUpdated") if isinstance(database, dict) else None,
            },
        }

    def _progress_summary(self, progress: dict[str, Any]) -> dict[str, Any]:
        if self.mode == "popular":
            pages_scanned = int(progress.get("pagesScanned") or 0)
            return {
                "scraped": int(progress.get("scraped") or 0),
                "videosScanned": int(progress.get("videosScanned") or 0),
                "pagesScanned": pages_scanned,
                "remainingPages": max(0, self.pages - pages_scanned),
                "targetPages": self.pages,
            }

        last_uid = int(progress.get("lastUid") or 0)
        range_total = max(0, self.end_uid - self.start_uid + 1)
        remaining = self.end_uid - max(last_uid, self.start_uid - 1)
        errors = progress.get("errors") if isinstance(progress.get("errors"), list) else []
        return {
            "lastUid": last_uid,
            "completed": int(progress.get("completed") or 0),
            "errors": len(errors),
            "remaining": max(0, remaining),
            "rangeTotal": range_total,
        }

    def _database_summary(self, database: Any) -> dict[str, int]:
        users = database.get("users") if isinstance(database, dict) and isinstance(database.get("users"), dict) else {}
        comments = 0
        danmaku = 0
        with_comments = 0
        for user in users.values():
            if not isinstance(user, dict):
                continue
            comment_count = self._count_comments(user)
            danmaku_count = self._count_danmaku(user)
            comments += comment_count
            danmaku += danmaku_count
            if comment_count > 0:
                with_comments += 1
        return {"users": len(users), "withComments": with_comments, "comments": comments, "danmaku": danmaku}

    def _count_comments(self, user: dict[str, Any]) -> int:
        if isinstance(user.get("comments"), list):
            return len(user["comments"])
        if isinstance(user.get("commentCount"), int):
            return user["commentCount"]
        text = user.get("commentText")
        return len([line for line in str(text).splitlines() if line.strip()]) if text else 0

    def _count_danmaku(self, user: dict[str, Any]) -> int:
        if isinstance(user.get("danmaku"), list):
            return len(user["danmaku"])
        if isinstance(user.get("danmakuCount"), int):
            return user["danmakuCount"]
        text = user.get("danmakuText")
        return len([line for line in str(text).splitlines() if line.strip()]) if text else 0

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
