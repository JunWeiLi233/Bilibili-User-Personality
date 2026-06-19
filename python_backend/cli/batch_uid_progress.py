from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class BatchUidProgressRunner:
    """Summarize batchUidScrape.js progress JSON without mutating scraper state."""

    def __init__(self, progress_path: str | Path):
        self.progress_path = Path(progress_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        uid_comments = payload.get("_uidComments") if isinstance(payload.get("_uidComments"), dict) else {}
        processed_uids = payload.get("processedUids") if isinstance(payload.get("processedUids"), dict) else {}
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        comment_total = sum(len(comments) for comments in uid_comments.values() if isinstance(comments, list))
        uid_count = len(uid_comments)
        success_count = sum(1 for status in processed_uids.values() if status == "success")
        error_count = sum(1 for status in processed_uids.values() if str(status).startswith("error"))
        skipped_count = sum(1 for status in processed_uids.values() if status == "no_text")
        normalized_stats = {
            "videosScanned": int(stats.get("videosScanned") or len(payload.get("scannedBvids") or [])),
            "uidsFound": int(stats.get("uidsFound") or uid_count),
            "uidsAnalyzed": int(stats.get("uidsAnalyzed") or success_count),
            "commentsCollected": int(stats.get("commentsCollected") or 0),
            "errors": int(stats.get("errors") or 0),
        }
        return {
            "ok": True,
            "discovery": {
                "videosScanned": normalized_stats["videosScanned"],
                "uidsDiscovered": uid_count,
                "commentsCollected": normalized_stats["commentsCollected"],
            },
            "phase2": {
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
            "stats": normalized_stats,
            "lastUpdated": payload.get("lastUpdated") or None,
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class BatchUidProgressContractComparator:
    """Compare Python batch UID progress reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("discovery", "phase2", "comments", "stats")

    def __init__(self, progress_path: str | Path, js_report_path: str | Path):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = BatchUidProgressRunner(self.progress_path).run()
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
    parser = argparse.ArgumentParser(description="Summarize batch UID scrape progress JSON.")
    parser.add_argument("--progress", default="server/data/batch-uid-progress.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch UID progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BatchUidProgressContractComparator(args.progress, args.compare_js_report).compare()
    else:
        result = BatchUidProgressRunner(args.progress).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
