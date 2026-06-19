from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class UidRangeProgressRunner:
    """Summarize batchUidRange.js progress JSON without mutating scraper state."""

    def __init__(self, progress_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.start = int(start)
        self.end = int(end)

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        uid_comments = payload.get("_uidComments") if isinstance(payload.get("_uidComments"), dict) else {}
        processed_uids = payload.get("processedUids") if isinstance(payload.get("processedUids"), dict) else {}
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        target_uids = [uid for uid in uid_comments if self._in_range(uid)]
        processed_target_uids = {uid: status for uid, status in processed_uids.items() if self._in_range(uid)}
        success_count = sum(1 for status in processed_target_uids.values() if status == "success")
        error_count = sum(1 for status in processed_target_uids.values() if str(status).startswith("error"))
        skipped_count = int(stats.get("skipped") or 0)
        target_comment_total = sum(len(comments) for uid, comments in uid_comments.items() if self._in_range(uid) and isinstance(comments, list))
        target_count = len(target_uids)
        return {
            "ok": True,
            "range": {"start": self.start, "end": self.end},
            "discovery": {
                "videosScanned": int(stats.get("videosScanned") or len(payload.get("scannedBvids") or [])),
                "uidsDiscovered": len(uid_comments),
                "targetUidsDiscovered": int(stats.get("targetUidsFound") or target_count),
                "commentsCollected": int(stats.get("commentsCollected") or 0),
            },
            "phase2": {
                "processed": len(processed_target_uids),
                "success": success_count,
                "errors": error_count,
                "skipped": skipped_count,
                "remaining": max(0, target_count - len(processed_target_uids)),
            },
            "comments": {
                "totalForTargetUids": target_comment_total,
                "averagePerTargetUid": round(target_comment_total / target_count, 2) if target_count else 0,
            },
            "lastUpdated": payload.get("lastUpdated") or None,
        }

    def _in_range(self, uid: Any) -> bool:
        try:
            value = int(str(uid))
        except ValueError:
            return False
        return self.start <= value <= self.end

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidRangeProgressContractComparator:
    """Compare Python UID range progress reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("range", "discovery", "phase2", "comments")

    def __init__(self, progress_path: str | Path, js_report_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)
        self.start = start
        self.end = end

    def compare(self) -> dict[str, Any]:
        python_result = UidRangeProgressRunner(self.progress_path, start=self.start, end=self.end).run()
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
