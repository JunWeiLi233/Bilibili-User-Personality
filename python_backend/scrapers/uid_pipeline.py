from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


STAT_KEYS = ("success", "noComments", "noVideos", "noUser", "trainError", "blocked", "errors")
MERGE_STAT_KEYS = ("success", "noComments", "noUser", "trainError", "blocked", "errors")


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed


class UidPipelineWorkerPlanner:
    """Build a dry-run plan for uidPipelineWorker.js range processing."""

    DEFAULT_START = 1
    DEFAULT_END = 100000
    VIDEOS_PER_USER = 3
    COMMENT_PAGES_PER_VIDEO = 2
    DELAY_UID_MS = 1500
    DELAY_REQUEST_MS = 500
    SAVE_EVERY = 20
    LOCK_RETRY_DELAY_MS = 10000
    LOCK_MAX_RETRIES = 5
    BLOCK_BACKOFF_BASE_MS = 30000
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
                "commentTextMinChars": self.COMMENT_TEXT_MIN_CHARS,
                "commentTextLimit": self.COMMENT_TEXT_LIMIT,
            },
            "pacing": {"delayUidMs": self.DELAY_UID_MS, "delayRequestMs": self.DELAY_REQUEST_MS, "saveEvery": self.SAVE_EVERY},
            "training": {"multiagent": True, "existingTermsOnly": False, "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS, "lockMaxRetries": self.LOCK_MAX_RETRIES},
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


class UidPipelineMergeReporter:
    """Merge UID pipeline worker progress payloads into the JS report contract."""

    def __init__(self, now: Any | None = None):
        self.now = now or (lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def build_report(
        self,
        chunks: list[dict[str, Any]] | None = None,
        *,
        users: dict[str, Any] | None = None,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        chunk_size: int = 0,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        chunks = chunks if isinstance(chunks, list) else []
        users = users if isinstance(users, dict) else {}
        total_start = int(total_start)
        total_end = int(total_end)
        workers = max(1, int(workers))
        total_expected = max(0, total_end - total_start + 1)
        merged_processed: dict[str, Any] = {}
        merged_stats = {key: 0 for key in MERGE_STAT_KEYS}
        chunk_summaries = []
        for chunk in chunks:
            progress = chunk.get("progress") if isinstance(chunk, dict) and isinstance(chunk.get("progress"), dict) else {}
            processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
            stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
            start = int(chunk.get("start") or 0) if isinstance(chunk, dict) else 0
            end = int(chunk.get("end") or 0) if isinstance(chunk, dict) else 0
            path = str(chunk.get("path") or "") if isinstance(chunk, dict) else ""
            if not processed:
                chunk_summaries.append({"start": start, "end": end, "path": path, "processed": 0, "skipped": True})
                continue
            merged_processed.update(processed)
            for key in MERGE_STAT_KEYS:
                merged_stats[key] += _parse_number_or(stats.get(key), 0)
            chunk_summaries.append({"start": start, "end": end, "path": path, "processed": len(processed), "skipped": False})
        result = {
            "ok": True,
            "range": {"start": total_start, "end": total_end, "workers": workers, "chunkSize": max(0, int(chunk_size))},
            "stats": merged_stats,
            "lastUpdated": self.now(),
            "chunks": chunk_summaries,
            "totalProcessed": len(merged_processed),
            "totalExpected": total_expected,
            "usersInDb": len(users),
            "summary": {
                "totalProcessed": len(merged_processed),
                "totalExpected": total_expected,
                "usersInDb": len(users),
                "stats": merged_stats,
            },
        }
        if not summary_only:
            result["processed"] = merged_processed
        return result
