from __future__ import annotations

from typing import Any


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed


class UidParallelAnalyzerPlanner:
    """Build a dry-run plan for uidParallelAnalyzer.js worker assignment."""

    DEFAULT_WORKER_ID = 0
    DEFAULT_WORKERS = 4
    LOCK_RETRY_DELAY_MS = 3000
    LOCK_RETRY_JITTER_MS = 2000
    LOCK_MAX_RETRIES = 15
    STALE_LOCK_REMOVAL_AFTER_ATTEMPT = 8
    SAVE_EVERY = 20
    COMMENT_TEXT_LIMIT = 5000

    def build_plan(
        self,
        argv: list[Any] | None = None,
        comments: dict[str, Any] | None = None,
        progress: dict[str, Any] | None = None,
        database: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        argv = argv or []
        comments = comments or {}
        progress = progress or {}
        database = database or {}
        options = self._parse_args(argv)
        worker_id = options["worker"]
        total_workers = max(1, options["workers"])
        assigned_uids = [uid for index, uid in enumerate(comments.keys()) if index % total_workers == worker_id]
        processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        pending_uids = [uid for uid in assigned_uids if uid not in processed]
        skippable_no_text = sum(1 for uid in pending_uids if not self._comment_text(comments.get(uid)).strip())
        trainable = len(pending_uids) - skippable_no_text
        assigned_set = set(assigned_uids)
        return {
            "ok": True,
            "worker": {"id": worker_id, "totalWorkers": total_workers, "assigned": len(assigned_uids)},
            "assignment": {
                "assignedUids": assigned_uids,
                "alreadyProcessed": sum(1 for uid in assigned_uids if uid in processed),
                "pending": len(pending_uids),
                "trainable": trainable,
                "skippableNoText": skippable_no_text,
            },
            "training": {"multiagent": True, "existingTermsOnly": False, "commentTextLimit": self.COMMENT_TEXT_LIMIT, "saveEvery": self.SAVE_EVERY},
            "pacing": {
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockRetryJitterMs": self.LOCK_RETRY_JITTER_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
                "staleLockRemovalAfterAttempt": self.STALE_LOCK_REMOVAL_AFTER_ATTEMPT,
            },
            "stats": {"success": _parse_number_or(stats.get("success"), 0), "noText": _parse_number_or(stats.get("noText"), 0), "errors": _parse_number_or(stats.get("errors"), 0)},
            "userDb": {"users": len(users), "assignedUsersInDb": sum(1 for uid in users if uid in assigned_set)},
        }

    def _parse_args(self, argv: list[Any]) -> dict[str, int]:
        options = {"worker": self.DEFAULT_WORKER_ID, "workers": self.DEFAULT_WORKERS}
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--worker="):
                options["worker"] = _parse_number_or(arg.split("=", 1)[1], self.DEFAULT_WORKER_ID)
            elif arg.startswith("--workers="):
                options["workers"] = _parse_number_or(arg.split("=", 1)[1], self.DEFAULT_WORKERS)
        return options

    def _comment_text(self, entries: Any) -> str:
        if not isinstance(entries, list):
            return ""
        return "\n".join(str(entry.get("message") or "") for entry in entries if isinstance(entry, dict))
