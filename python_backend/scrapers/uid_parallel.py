from __future__ import annotations

from typing import Any


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed


class UidParallelProgressReporter:
    """Build a JS-compatible progress summary for one UID parallel worker."""

    STAT_KEYS = ("success", "noText", "errors")

    def __init__(self, *, worker_id: int = 0, total_workers: int = 4):
        self.worker_id = int(worker_id)
        self.total_workers = max(1, int(total_workers))

    def build_report(self, all_comments: Any, progress_payload: Any, users: Any) -> dict[str, Any]:
        progress = progress_payload if isinstance(progress_payload, dict) else {}
        processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        assigned_uids = self._assigned_uids(all_comments)
        assigned_count = len(assigned_uids)
        processed_count = len(processed)
        assigned_set = set(assigned_uids)
        user_map = users if isinstance(users, dict) else {}
        return {
            "ok": True,
            "worker": {"id": self.worker_id, "totalWorkers": self.total_workers, "assigned": assigned_count},
            "progress": {
                "processed": processed_count,
                "remaining": max(0, assigned_count - processed_count),
                "completionRatio": round(processed_count / assigned_count, 4) if assigned_count else 0,
            },
            "stats": {key: _parse_number_or(stats.get(key), 0) for key in self.STAT_KEYS},
            "statusCounts": self._status_counts(processed),
            "userDb": {"users": len(user_map), "assignedUsersInDb": sum(1 for uid in user_map if uid in assigned_set)},
            "lastUpdated": progress.get("lastUpdated") or None,
        }

    def _assigned_uids(self, all_comments: Any) -> list[str]:
        if not isinstance(all_comments, dict):
            return []
        return [uid for index, uid in enumerate(all_comments.keys()) if index % self.total_workers == self.worker_id]

    def _status_counts(self, processed: dict[str, Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for status in processed.values():
            key = str(status)
            counts[key] = counts.get(key, 0) + 1
        return counts


class UidParallelProgressSummary:
    """Shape UID parallel progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("worker", "progress", "stats", "statusCounts", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


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

    @classmethod
    def build_plan_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        return cls().build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            comments=payload.get("comments") if isinstance(payload.get("comments"), dict) else {},
            progress=payload.get("progress") if isinstance(payload.get("progress"), dict) else {},
            database=payload.get("database") if isinstance(payload.get("database"), dict) else {},
        )

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


class UidParallelPlanSummary:
    """Shape UID parallel analyzer plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("worker", "assignment", "training", "pacing", "stats", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidParallelPlanContractComparator:
    """Compare UID parallel analyzer plan payloads using the JS/Python summary contract."""

    def __init__(self, summary: UidParallelPlanSummary | None = None):
        self.summary = summary or UidParallelPlanSummary()

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
