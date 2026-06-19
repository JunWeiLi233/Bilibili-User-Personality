from __future__ import annotations

from typing import Any


STAT_KEYS = ("success", "noComments", "noVideos", "noUser", "trainError", "blocked", "errors")


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class UidFastPipelinePlanner:
    """Build a dry-run plan for uidPipelineFast.js direct-fetch range processing."""

    DEFAULT_START = 1
    DEFAULT_END = 100000
    VIDEOS_PER_USER = 3
    COMMENT_PAGES_PER_VIDEO = 2
    REPLY_PAGE_SIZE = 20
    DELAY_UID_MS = 3500
    DELAY_FAST_FAIL_UID_MS = 1800
    DELAY_REQUEST_MS = 1800
    CURSOR_DELAY_MS = 200
    SAVE_EVERY = 20
    LOCK_RETRY_DELAY_MS = 5000
    LOCK_RETRY_JITTER_MS = 2000
    LOCK_MAX_RETRIES = 15
    FORCE_CLEAN_LOCK_AFTER_ATTEMPT = 10
    BLOCK_BACKOFF_BASE_MS = 15000
    BLOCK_BACKOFF_MAX_MULTIPLIER = 10
    COMMENT_TEXT_MIN_CHARS = 10
    COMMENT_TEXT_LIMIT = 8000
    BLOCKED_CODES = (-799, -352)

    def build_plan(self, argv: list[Any] | None = None, progress: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        progress = progress or {}
        database = database or {}
        options = self._parse_args(argv)
        start = options["start"]
        end = options["end"]
        total = max(0, end - start + 1)
        processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        processed_count = len(processed)
        return {
            "ok": True,
            "range": {"start": start, "end": end, "total": total},
            "progress": {
                "processed": processed_count,
                "remaining": max(0, total - processed_count),
                "completionRatio": round(processed_count / total, 4) if total else 0,
            },
            "limits": {
                "videosPerUser": self.VIDEOS_PER_USER,
                "commentPagesPerVideo": self.COMMENT_PAGES_PER_VIDEO,
                "replyPageSize": self.REPLY_PAGE_SIZE,
                "commentTextMinChars": self.COMMENT_TEXT_MIN_CHARS,
                "commentTextLimit": self.COMMENT_TEXT_LIMIT,
            },
            "network": {"mode": "directFetchJson", "usesCrawlerRateLimiter": False, "hasUserAgent": True},
            "pacing": {
                "delayUidMs": self.DELAY_UID_MS,
                "delayFastFailUidMs": self.DELAY_FAST_FAIL_UID_MS,
                "delayRequestMs": self.DELAY_REQUEST_MS,
                "cursorDelayMs": self.CURSOR_DELAY_MS,
                "saveEvery": self.SAVE_EVERY,
            },
            "training": {
                "multiagent": True,
                "existingTermsOnly": False,
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockRetryJitterMs": self.LOCK_RETRY_JITTER_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
                "forceCleanLockAfterAttempt": self.FORCE_CLEAN_LOCK_AFTER_ATTEMPT,
            },
            "blockPolicy": {
                "blockedCodes": list(self.BLOCKED_CODES),
                "consecutiveBlockThreshold": 3,
                "blockBackoffBaseMs": self.BLOCK_BACKOFF_BASE_MS,
                "blockBackoffMaxMultiplier": self.BLOCK_BACKOFF_MAX_MULTIPLIER,
            },
            "stats": {key: _parse_number_or(stats.get(key), 0) for key in STAT_KEYS},
            "userDb": {"users": len(users), "usersInRange": self._users_in_range(users, start, end)},
        }

    def _parse_args(self, argv: list[Any]) -> dict[str, int]:
        options = {"start": self.DEFAULT_START, "end": self.DEFAULT_END}
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                options["start"] = _parse_number_or(arg.split("=", 1)[1], self.DEFAULT_START)
            elif arg.startswith("--end="):
                options["end"] = _parse_number_or(arg.split("=", 1)[1], self.DEFAULT_END)
        return options

    def _users_in_range(self, users: dict[str, Any], start: int, end: int) -> int:
        count = 0
        for uid in users:
            try:
                numeric_uid = int(str(uid))
            except (TypeError, ValueError):
                continue
            if start <= numeric_uid <= end:
                count += 1
        return count
