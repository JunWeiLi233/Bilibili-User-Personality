from __future__ import annotations

from typing import Any


def _int_or_zero(value: Any) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0


class UidDiscoveryPlanner:
    """Build a dry-run plan for uidDiscoveryScrape.js UID discovery workflow."""

    POPULAR_PAGES = 30
    POPULAR_PAGE_SIZE = 20
    RANKING_CATEGORIES = 94
    REPLY_PAGES_PER_VIDEO = 2
    REPLY_PAGE_SIZE = 20
    DELAY_MS = 600
    CURSOR_DELAY_MS = 200
    SAVE_EVERY = 100
    EMPTY_BACKOFF_THRESHOLD = 20
    EMPTY_BACKOFF_MS = 15000
    LOCK_RETRY_DELAY_MS = 5000
    LOCK_RETRY_JITTER_MS = 2000
    LOCK_MAX_RETRIES = 15
    SAVE_EVERY_ANALYZED = 10

    def build_plan(self, progress: dict[str, Any] | None = None, comments: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        progress = progress or {}
        comments = comments or {}
        database = database or {}
        phase = str(progress.get("phase") or "discovery")
        scanned_bvids = progress.get("scannedBvids") if isinstance(progress.get("scannedBvids"), list) else []
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        uid_comments = comments if isinstance(comments, dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        pending_items = [(uid, entries) for uid, entries in uid_comments.items() if uid not in processed_uids]
        skippable_no_text = sum(1 for _, entries in pending_items if not self._comment_text(entries).strip())
        trainable = len(pending_items) - skippable_no_text
        return {
            "ok": True,
            "resume": {
                "phase": phase,
                "skipDiscovery": phase == "analysis" and bool(uid_comments),
                "scannedBvids": len(scanned_bvids),
                "savedUidComments": len(uid_comments),
            },
            "sources": {
                "popularPages": self.POPULAR_PAGES,
                "popularPageSize": self.POPULAR_PAGE_SIZE,
                "rankingCategories": self.RANKING_CATEGORIES,
                "searchEnabled": True,
            },
            "scanning": {
                "replyPagesPerVideo": self.REPLY_PAGES_PER_VIDEO,
                "replyPageSize": self.REPLY_PAGE_SIZE,
                "delayMs": self.DELAY_MS,
                "cursorDelayMs": self.CURSOR_DELAY_MS,
                "saveEvery": self.SAVE_EVERY,
                "emptyBackoffThreshold": self.EMPTY_BACKOFF_THRESHOLD,
                "emptyBackoffMs": self.EMPTY_BACKOFF_MS,
            },
            "analysis": {
                "processed": len(processed_uids),
                "pending": len(pending_items),
                "skippableNoText": skippable_no_text,
                "trainable": trainable,
                "userDbUsers": len(users),
            },
            "stats": {
                "videosScanned": _int_or_zero(stats.get("videosScanned")),
                "uidsFound": _int_or_zero(stats.get("uidsFound")) or len(uid_comments),
                "uidsAnalyzed": _int_or_zero(stats.get("uidsAnalyzed")),
                "commentsCollected": _int_or_zero(stats.get("commentsCollected")),
                "errors": _int_or_zero(stats.get("errors")),
                "videoQueueSize": _int_or_zero(progress.get("videoQueueSize")),
            },
            "training": {
                "multiagent": True,
                "existingTermsOnly": False,
                "saveEveryAnalyzed": self.SAVE_EVERY_ANALYZED,
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockRetryJitterMs": self.LOCK_RETRY_JITTER_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
            },
        }

    def _comment_text(self, entries: Any) -> str:
        if not isinstance(entries, list):
            return ""
        return "\n".join(str(entry.get("message") or "") for entry in entries if isinstance(entry, dict))


class UidDiscoveryPlanSummary:
    """Shape UID discovery dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("resume", "sources", "scanning", "analysis", "stats", "training")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidDiscoveryProgressReporter:
    """Summarize UID discovery progress payloads into the JS-compatible report shape."""

    def build_report(self, progress: Any, uid_comments: Any, users: Any) -> dict[str, Any]:
        progress_payload = progress if isinstance(progress, dict) else {}
        comments = uid_comments if isinstance(uid_comments, dict) else {}
        user_map = users if isinstance(users, dict) else {}
        processed_uids = progress_payload.get("processedUids") if isinstance(progress_payload.get("processedUids"), dict) else {}
        stats = progress_payload.get("stats") if isinstance(progress_payload.get("stats"), dict) else {}
        scanned_bvids = progress_payload.get("scannedBvids") if isinstance(progress_payload.get("scannedBvids"), list) else []
        comment_total = sum(len(entries) for entries in comments.values() if isinstance(entries, list))
        uid_count = len(comments)
        success_count = sum(1 for status in processed_uids.values() if status == "success")
        error_count = sum(1 for status in processed_uids.values() if str(status).startswith("error"))
        skipped_count = sum(1 for status in processed_uids.values() if status == "no_text")
        videos_scanned = _int_or_zero(stats.get("videosScanned")) or len(scanned_bvids)
        return {
            "ok": True,
            "phase": progress_payload.get("phase") or "discovery",
            "discovery": {
                "videosScanned": videos_scanned,
                "videoQueueSize": _int_or_zero(progress_payload.get("videoQueueSize")),
                "uidsDiscovered": _int_or_zero(stats.get("uidsFound")) or uid_count,
                "commentsCollected": _int_or_zero(stats.get("commentsCollected")),
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
                "uidsWithComments": sum(1 for entries in comments.values() if isinstance(entries, list) and entries),
            },
            "stats": {
                "videosScanned": videos_scanned,
                "uidsFound": _int_or_zero(stats.get("uidsFound")) or uid_count,
                "uidsAnalyzed": _int_or_zero(stats.get("uidsAnalyzed")) or success_count,
                "commentsCollected": _int_or_zero(stats.get("commentsCollected")),
                "errors": _int_or_zero(stats.get("errors")),
            },
            "userDb": {"users": len(user_map)},
            "lastUpdated": progress_payload.get("lastUpdated") or None,
        }


class UidDiscoveryProgressSummary:
    """Shape UID discovery progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("phase", "discovery", "analysis", "comments", "stats", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}
