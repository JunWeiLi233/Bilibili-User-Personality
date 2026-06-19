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
