from __future__ import annotations

from pathlib import Path
from typing import Any


BATCH_LAUNCHER_RANGES = (
    {"start": 1, "end": 20000, "progressFile": "batch-uid-progress-1-20000.json"},
    {"start": 20001, "end": 40000, "progressFile": "batch-uid-progress-20001-40000.json"},
    {"start": 40001, "end": 60000, "progressFile": "batch-uid-progress-40001-60000.json"},
    {"start": 60001, "end": 80000, "progressFile": "batch-uid-progress-60001-80000.json"},
    {"start": 80001, "end": 100000, "progressFile": "batch-uid-progress-80001-100000.json"},
)


def _int_or_zero(value: Any) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


class BatchUidScrapePlanner:
    """Build a dry-run plan for batchUidScrape.js video-based UID discovery."""

    POPULAR_PAGES = 50
    VIDEOS_PER_PAGE = 20
    COMMENT_PAGES_PER_VIDEO = 3
    DELAY_BETWEEN_VIDEOS_MS = 2000
    LOCK_RETRY_DELAY_MS = 10000
    LOCK_MAX_RETRIES = 10
    SAVE_EVERY_ANALYZED = 10

    @classmethod
    def build_plan_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        return cls().build_plan(
            progress=payload.get("progress") if isinstance(payload.get("progress"), dict) else {},
            database=payload.get("database") if isinstance(payload.get("database"), dict) else {},
        )

    def build_plan(self, progress: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        progress = progress or {}
        database = database or {}
        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        scanned_bvids = progress.get("scannedBvids") if isinstance(progress.get("scannedBvids"), list) else []
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        pending_items = [(uid, comments) for uid, comments in uid_comments.items() if uid not in processed_uids]
        skippable_no_text = sum(1 for _, comments in pending_items if not self._comment_text(comments).strip())
        trainable = len(pending_items) - skippable_no_text
        normalized_stats = {
            "videosScanned": _int_or_zero(stats.get("videosScanned")),
            "uidsFound": _int_or_zero(stats.get("uidsFound")) or len(uid_comments),
            "uidsAnalyzed": _int_or_zero(stats.get("uidsAnalyzed")),
            "commentsCollected": _int_or_zero(stats.get("commentsCollected")),
            "errors": _int_or_zero(stats.get("errors")),
        }
        return {
            "ok": True,
            "discovery": {
                "popularPages": self.POPULAR_PAGES,
                "videosPerPage": self.VIDEOS_PER_PAGE,
                "commentPagesPerVideo": self.COMMENT_PAGES_PER_VIDEO,
                "scannedBvids": len(scanned_bvids),
                "uidsDiscovered": len(uid_comments),
            },
            "phase2": {
                "processed": len(processed_uids),
                "pending": len(pending_items),
                "skippableNoText": skippable_no_text,
                "trainable": trainable,
                "userDbUsers": len(users),
            },
            "stats": normalized_stats,
            "training": {"multiagent": True, "existingTermsOnly": False, "saveEveryAnalyzed": self.SAVE_EVERY_ANALYZED},
            "pacing": {
                "delayBetweenVideosMs": self.DELAY_BETWEEN_VIDEOS_MS,
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
            },
        }

    def _comment_text(self, comments: Any) -> str:
        if not isinstance(comments, list):
            return ""
        return "\n".join(str(comment.get("message") or "") for comment in comments if isinstance(comment, dict))


class BatchUidScrapePlanSummary:
    """Shape batch UID scrape dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("discovery", "phase2", "stats", "training", "pacing")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BatchUidScrapePlanContractComparator:
    """Compare batch UID scrape plan payloads using the JS/Python summary contract."""

    def __init__(self, summary: BatchUidScrapePlanSummary | None = None):
        self.summary = summary or BatchUidScrapePlanSummary()

    def compare(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> dict[str, Any]:
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


class BatchScraperLauncherPlanner:
    """Build a dry-run launch plan compatible with launchAllScrapers.js ranges."""

    def build_plan(self, *, data_dir: str | Path, script: str = "server/scripts/batchUidScrape.js") -> dict[str, Any]:
        data_dir = Path(data_dir)
        workers = []
        for item in BATCH_LAUNCHER_RANGES:
            start = int(item["start"])
            end = int(item["end"])
            progress_file = str(item["progressFile"])
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": f"scraper-logs/scraper-{start}-{end}.log",
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
            "summary": {"workers": len(workers), "totalStart": total_start, "totalEnd": total_end, "totalUids": total_uids},
        }


class BatchScraperLauncherSummary:
    """Shape batch scraper launcher plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("workers", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        summary: dict[str, Any] = {}
        if "workers" in result:
            summary["workers"] = [
                {"start": worker["start"], "end": worker["end"], "progressFile": worker["progressFile"]}
                for worker in result.get("workers", [])
                if isinstance(worker, dict)
            ]
        if "summary" in result:
            summary["summary"] = result.get("summary")
        return summary


class BatchScraperLauncherContractComparator:
    """Compare batch scraper launcher payloads with the shared JS/Python contract."""

    def __init__(self, summary: BatchScraperLauncherSummary | None = None):
        self.summary = summary or BatchScraperLauncherSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class BatchUidProgressReporter:
    """Summarize batch UID scrape progress payloads into the JS-compatible report shape."""

    def build_report(self, payload: Any) -> dict[str, Any]:
        progress = payload if isinstance(payload, dict) else {}
        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        comment_total = sum(len(comments) for comments in uid_comments.values() if isinstance(comments, list))
        uid_count = len(uid_comments)
        success_count = sum(1 for status in processed_uids.values() if status == "success")
        error_count = sum(1 for status in processed_uids.values() if str(status).startswith("error"))
        skipped_count = sum(1 for status in processed_uids.values() if status == "no_text")
        normalized_stats = {
            "videosScanned": _int_or_zero(stats.get("videosScanned")) or len(progress.get("scannedBvids") or []),
            "uidsFound": _int_or_zero(stats.get("uidsFound")) or uid_count,
            "uidsAnalyzed": _int_or_zero(stats.get("uidsAnalyzed")) or success_count,
            "commentsCollected": _int_or_zero(stats.get("commentsCollected")),
            "errors": _int_or_zero(stats.get("errors")),
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
            "lastUpdated": progress.get("lastUpdated") or None,
        }


class BatchUidProgressSummary:
    """Shape batch UID progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("discovery", "phase2", "comments", "stats")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BatchUidProgressContractComparator:
    """Compare batch UID progress reports using the JS/Python summary contract."""

    def __init__(self, summary: BatchUidProgressSummary | None = None):
        self.summary = summary or BatchUidProgressSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
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
