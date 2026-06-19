from __future__ import annotations

from pathlib import Path
from typing import Any


RANGE_LAUNCHER_RANGES = (
    {"start": 1, "end": 20000, "progressFile": "uid-range-progress-1-20000.json"},
    {"start": 20001, "end": 40000, "progressFile": "uid-range-progress-20001-40000.json"},
    {"start": 40001, "end": 60000, "progressFile": "uid-range-progress-40001-60000.json"},
    {"start": 60001, "end": 80000, "progressFile": "uid-range-progress-60001-80000.json"},
    {"start": 80001, "end": 100000, "progressFile": "uid-range-progress-80001-100000.json"},
)


def _js_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed or fallback


def _progress_number_or(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class BatchUidRangePlanner:
    """Build a dry-run plan for batchUidRange.js discovery and analysis phases."""

    DEFAULT_START = 200000
    DEFAULT_END = 300000
    DEFAULT_PAGES = 200
    POPULAR_PAGE_SIZE = 20
    COMMENT_PAGES_PER_VIDEO = 3
    DELAY_BETWEEN_VIDEOS_MS = 2000
    DELAY_BETWEEN_UIDS_MS = 1500
    LOCK_RETRY_DELAY_MS = 3000
    LOCK_MAX_RETRIES = 10
    SAVE_INTERVAL = 5

    def build_plan(self, argv: list[Any] | None = None, progress: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        progress = progress or {}
        database = database or {}
        start = self.DEFAULT_START
        end = self.DEFAULT_END
        pages = self.DEFAULT_PAGES
        phase2_only = False
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                start = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_START)
            elif arg.startswith("--end="):
                end = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_END)
            elif arg.startswith("--pages="):
                pages = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_PAGES)
            elif arg == "--phase2-only":
                phase2_only = True

        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        scanned_bvids = progress.get("scannedBvids") if isinstance(progress.get("scannedBvids"), list) else []
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        target_uids = [uid for uid in uid_comments if self._uid_in_range(uid, start, end)]
        processed_targets = sum(1 for uid in target_uids if uid in processed_uids)
        normalized_stats = {
            "videosScanned": _js_number_or(stats.get("videosScanned"), 0) if stats.get("videosScanned") else 0,
            "uidsFound": _js_number_or(stats.get("uidsFound"), len(uid_comments)) if stats.get("uidsFound") else len(uid_comments),
            "targetUidsFound": _js_number_or(stats.get("targetUidsFound"), len(target_uids)) if stats.get("targetUidsFound") else len(target_uids),
            "commentsCollected": _js_number_or(stats.get("commentsCollected"), 0) if stats.get("commentsCollected") else 0,
            "analyzed": _js_number_or(stats.get("analyzed"), 0) if stats.get("analyzed") else 0,
            "skipped": _js_number_or(stats.get("skipped"), 0) if stats.get("skipped") else 0,
            "errors": _js_number_or(stats.get("errors"), 0) if stats.get("errors") else 0,
        }
        return {
            "ok": True,
            "input": {"start": start, "end": end, "pages": pages, "phase2Only": phase2_only},
            "phase1": {
                "enabled": not phase2_only,
                "scannedBvids": len(scanned_bvids),
                "maxPages": pages,
                "popularPageSize": self.POPULAR_PAGE_SIZE,
                "commentPagesPerVideo": self.COMMENT_PAGES_PER_VIDEO,
            },
            "phase2": {"targetUids": len(target_uids), "processed": processed_targets, "remaining": max(0, len(target_uids) - processed_targets), "userDbUsers": len(users)},
            "stats": normalized_stats,
            "pacing": {
                "delayBetweenVideosMs": self.DELAY_BETWEEN_VIDEOS_MS,
                "delayBetweenUidsMs": self.DELAY_BETWEEN_UIDS_MS,
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
                "saveInterval": self.SAVE_INTERVAL,
            },
        }

    def _uid_in_range(self, uid: Any, start: int, end: int) -> bool:
        try:
            value = int(float(str(uid)))
        except (TypeError, ValueError):
            return False
        return start <= value <= end


class BatchUidRangePlanSummary:
    """Shape batch UID range dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("input", "phase1", "phase2", "stats", "pacing")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class RangeScraperLauncherPlanner:
    """Build a dry-run launch plan compatible with launchRangeScrapers.ps1."""

    def build_plan(
        self,
        *,
        data_dir: str | Path,
        script: str = "server/scripts/uidRangeScrape.js",
        launch_delay_seconds: int = 3,
    ) -> dict[str, Any]:
        data_dir = Path(data_dir)
        launch_delay_seconds = int(launch_delay_seconds)
        workers = []
        for item in RANGE_LAUNCHER_RANGES:
            start = int(item["start"])
            end = int(item["end"])
            progress_file = str(item["progressFile"])
            log_name = f"uid-range-{start}-{end}.log"
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": f"scraper-logs/{log_name}",
                    "stderrFile": f"scraper-logs/{log_name.replace('.log', '-stderr.log')}",
                    "args": [f"--start={start}", f"--end={end}", f"--progress={progress_file}"],
                }
            )

        total_start = workers[0]["start"] if workers else 0
        total_end = workers[-1]["end"] if workers else 0
        total_uids = sum(worker["end"] - worker["start"] + 1 for worker in workers)
        return {
            "ok": True,
            "script": script,
            "logDir": str(data_dir / "scraper-logs"),
            "workers": workers,
            "summary": {
                "workers": len(workers),
                "totalStart": total_start,
                "totalEnd": total_end,
                "totalUids": total_uids,
                "launchDelaySeconds": launch_delay_seconds,
            },
        }


class UidRangeProgressReporter:
    """Summarize batch UID range progress payloads into the JS-compatible report shape."""

    def __init__(self, *, start: int = 200000, end: int = 300000):
        self.start = int(start)
        self.end = int(end)

    def build_report(self, payload: Any) -> dict[str, Any]:
        progress = payload if isinstance(payload, dict) else {}
        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        target_uids = [uid for uid in uid_comments if self._in_range(uid)]
        processed_target_uids = {uid: status for uid, status in processed_uids.items() if self._in_range(uid)}
        success_count = sum(1 for status in processed_target_uids.values() if status == "success")
        error_count = sum(1 for status in processed_target_uids.values() if str(status).startswith("error"))
        target_comment_total = sum(len(comments) for uid, comments in uid_comments.items() if self._in_range(uid) and isinstance(comments, list))
        target_count = len(target_uids)
        return {
            "ok": True,
            "range": {"start": self.start, "end": self.end},
            "discovery": {
                "videosScanned": _progress_number_or(stats.get("videosScanned"), len(progress.get("scannedBvids") or [])) if stats.get("videosScanned") else len(progress.get("scannedBvids") or []),
                "uidsDiscovered": len(uid_comments),
                "targetUidsDiscovered": _progress_number_or(stats.get("targetUidsFound"), target_count) if stats.get("targetUidsFound") else target_count,
                "commentsCollected": _progress_number_or(stats.get("commentsCollected"), 0) if stats.get("commentsCollected") else 0,
            },
            "phase2": {
                "processed": len(processed_target_uids),
                "success": success_count,
                "errors": error_count,
                "skipped": _progress_number_or(stats.get("skipped"), 0) if stats.get("skipped") else 0,
                "remaining": max(0, target_count - len(processed_target_uids)),
            },
            "comments": {
                "totalForTargetUids": target_comment_total,
                "averagePerTargetUid": round(target_comment_total / target_count, 2) if target_count else 0,
            },
            "lastUpdated": progress.get("lastUpdated") or None,
        }

    def _in_range(self, uid: Any) -> bool:
        try:
            value = int(str(uid))
        except ValueError:
            return False
        return self.start <= value <= self.end


class UidRangeProgressSummary:
    """Shape UID range progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "discovery", "phase2", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}
