from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class UidDiscoveryProgressRunner:
    """Summarize uidDiscoveryScrape.js JSON artifacts without mutating scraper state."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        progress_file: str = "uid-discovery-progress.json",
        comments_file: str = "uid-discovery-comments.json",
        user_db_file: str = "scraped-users-db.json",
    ):
        self.data_dir = Path(data_dir)
        self.progress_path = self.data_dir / progress_file
        self.comments_path = self.data_dir / comments_file
        self.user_db_path = self.data_dir / user_db_file

    def run(self) -> dict[str, Any]:
        progress = self._read_json(self.progress_path, {})
        uid_comments = self._read_json(self.comments_path, {})
        user_db = self._read_json(self.user_db_path, {})

        if not isinstance(progress, dict):
            progress = {}
        if not isinstance(uid_comments, dict):
            uid_comments = {}
        users = user_db.get("users") if isinstance(user_db, dict) and isinstance(user_db.get("users"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}

        comment_total = sum(len(comments) for comments in uid_comments.values() if isinstance(comments, list))
        uid_count = len(uid_comments)
        success_count = sum(1 for status in processed_uids.values() if status == "success")
        error_count = sum(1 for status in processed_uids.values() if str(status).startswith("error"))
        skipped_count = sum(1 for status in processed_uids.values() if status == "no_text")
        scanned_bvids = progress.get("scannedBvids") if isinstance(progress.get("scannedBvids"), list) else []
        videos_scanned = int(stats.get("videosScanned") or len(scanned_bvids))

        return {
            "ok": True,
            "phase": progress.get("phase") or "discovery",
            "discovery": {
                "videosScanned": videos_scanned,
                "videoQueueSize": int(progress.get("videoQueueSize") or 0),
                "uidsDiscovered": int(stats.get("uidsFound") or uid_count),
                "commentsCollected": int(stats.get("commentsCollected") or 0),
            },
            "analysis": {
                "processed": len(processed_uids),
                "success": success_count,
                "errors": error_count,
                "skipped": skipped_count,
                "remaining": max(0, uid_count - len(processed_uids)),
            },
            "comments": {
                "total": comment_total,
                "averagePerUid": round(comment_total / uid_count, 2) if uid_count else 0,
                "uidsWithComments": sum(1 for comments in uid_comments.values() if isinstance(comments, list) and comments),
            },
            "stats": {
                "videosScanned": videos_scanned,
                "uidsFound": int(stats.get("uidsFound") or uid_count),
                "uidsAnalyzed": int(stats.get("uidsAnalyzed") or success_count),
                "commentsCollected": int(stats.get("commentsCollected") or 0),
                "errors": int(stats.get("errors") or 0),
            },
            "userDb": {"users": len(users)},
            "lastUpdated": progress.get("lastUpdated") or None,
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidDiscoveryProgressContractComparator:
    """Compare Python UID discovery summaries against saved JS-compatible JSON."""

    RESULT_KEYS = ("phase", "discovery", "analysis", "comments", "stats", "userDb")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = UidDiscoveryProgressRunner(self.data_dir).run()
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
    parser = argparse.ArgumentParser(description="Summarize UID discovery scrape progress JSON.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID discovery progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidDiscoveryProgressContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = UidDiscoveryProgressRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
