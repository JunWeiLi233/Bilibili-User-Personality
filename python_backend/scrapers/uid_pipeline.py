from __future__ import annotations

import math
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

    @classmethod
    def build_plan_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        return cls().build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            progress=payload.get("progress") if isinstance(payload.get("progress"), dict) else {},
            database=payload.get("database") if isinstance(payload.get("database"), dict) else {},
        )

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


class UidPipelinePlanSummary:
    """Shape UID pipeline worker plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "progress", "limits", "pacing", "training", "blockPolicy", "stats", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidPipelinePlanContractComparator:
    """Compare UID pipeline worker plan payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidPipelinePlanSummary | None = None):
        self.summary = summary or UidPipelinePlanSummary()

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


class UidPipelineLauncherPlanner:
    """Build a UID pipeline launcher plan without touching the filesystem."""

    def __init__(self, now: Any | None = None):
        self.now = now or (lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def build_plan(self, *, total_start: int = 1, total_end: int = 100000, workers: int = 5) -> dict[str, Any]:
        total_start = int(total_start)
        total_end = int(total_end)
        workers = max(1, int(workers))
        total_expected = max(0, total_end - total_start + 1)
        chunk_size = math.ceil(total_expected / workers) if total_expected else 0
        started_at = self.now()
        worker_plans = []
        state_workers = []

        for worker_index in range(workers):
            start = total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, total_end)
            if start > total_end:
                break
            progress_file = f"uid-pipeline-{start}-{end}.json"
            log_file = f"scraper-logs/uid-pipeline-{start}-{end}.log"
            state_workers.append({"start": start, "end": end, "progressFile": progress_file})
            worker_plans.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": log_file,
                    "args": [f"--start={start}", f"--end={end}"],
                }
            )

        return {
            "ok": True,
            "startedAt": started_at,
            "range": {"start": total_start, "end": total_end, "workers": workers, "chunkSize": chunk_size},
            "workers": worker_plans,
            "state": {"startedAt": started_at, "workers": state_workers},
        }


class UidPipelineLauncherSummary:
    """Shape UID pipeline launcher state into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("workers",)

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        raw_state = result.get("state") if isinstance(result.get("state"), dict) else result
        raw_workers = raw_state.get("workers") if isinstance(raw_state.get("workers"), list) else None
        if raw_workers is None:
            return {}
        return {
            "workers": [
                {"start": worker.get("start"), "end": worker.get("end"), "progressFile": worker.get("progressFile")}
                for worker in raw_workers
                if isinstance(worker, dict)
            ]
        }


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


class UidPipelineMergeSummary:
    """Shape UID pipeline merge reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("totalProcessed", "totalExpected", "usersInDb", "stats", "processed", "chunks", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidPipelineStateReporter:
    """Summarize UID pipeline launcher state and worker progress payloads."""

    def build_report(self, state_payload: dict[str, Any] | None = None, progress_by_file: dict[str, Any] | None = None) -> dict[str, Any]:
        state_payload = state_payload if isinstance(state_payload, dict) else {}
        progress_by_file = progress_by_file if isinstance(progress_by_file, dict) else {}
        raw_workers = state_payload.get("workers") if isinstance(state_payload.get("workers"), list) else []
        stats = {key: 0 for key in STAT_KEYS}
        workers = []
        total_processed = 0
        total_expected = 0
        completed_workers = 0

        for raw_worker in raw_workers:
            if not isinstance(raw_worker, dict):
                continue
            start = _parse_number_or(raw_worker.get("start"), 0)
            end = _parse_number_or(raw_worker.get("end"), 0)
            total = max(0, end - start + 1)
            progress_file = str(raw_worker.get("progressFile") or f"uid-pipeline-{start}-{end}.json")
            progress = progress_by_file.get(progress_file) if isinstance(progress_by_file.get(progress_file), dict) else {}
            processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
            progress_stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
            processed_count = len(processed)
            complete = bool(total and processed_count >= total)

            total_processed += processed_count
            total_expected += total
            completed_workers += 1 if complete else 0
            for key in STAT_KEYS:
                stats[key] += _parse_number_or(progress_stats.get(key), 0)
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "processed": processed_count,
                    "total": total,
                    "complete": complete,
                }
            )

        return {
            "ok": True,
            "startedAt": state_payload.get("startedAt") or None,
            "workers": workers,
            "stats": stats,
            "summary": {
                "workers": len(workers),
                "completedWorkers": completed_workers,
                "totalProcessed": total_processed,
                "totalExpected": total_expected,
                "completionRatio": round(total_processed / total_expected, 4) if total_expected else 0,
            },
        }


class UidPipelineStateSummary:
    """Shape UID pipeline launcher state reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("startedAt", "workers", "summary", "stats")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidPipelineStateContractComparator:
    """Compare UID pipeline state payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidPipelineStateSummary | None = None):
        self.summary = summary or UidPipelineStateSummary()

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


class UidPipelineProgressReporter:
    """Summarize one UID pipeline worker progress payload into the JS JSON contract."""

    def build_report(
        self,
        progress_payload: dict[str, Any] | None = None,
        *,
        users: dict[str, Any] | None = None,
        start: int = 0,
        end: int = 0,
    ) -> dict[str, Any]:
        progress_payload = progress_payload if isinstance(progress_payload, dict) else {}
        users = users if isinstance(users, dict) else {}
        start = int(start)
        end = int(end)
        processed = progress_payload.get("processed") if isinstance(progress_payload.get("processed"), dict) else {}
        stats = progress_payload.get("stats") if isinstance(progress_payload.get("stats"), dict) else {}
        total = max(0, end - start + 1)
        processed_count = len(processed)
        return {
            "ok": True,
            "range": {"start": start, "end": end, "total": total},
            "progress": {
                "processed": processed_count,
                "remaining": max(0, total - processed_count),
                "completionRatio": round(processed_count / total, 4) if total else 0,
            },
            "stats": {key: _parse_number_or(stats.get(key), 0) for key in STAT_KEYS},
            "statusCounts": self._status_counts(processed),
            "userDb": {"users": len(users), "usersInRange": self._users_in_range(users, start, end)},
            "lastUpdated": progress_payload.get("lastUpdated") or None,
        }

    def _status_counts(self, processed: dict[str, Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for status in processed.values():
            key = str(status)
            counts[key] = counts.get(key, 0) + 1
        return counts

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


class UidPipelineProgressSummary:
    """Shape UID pipeline progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "progress", "stats", "statusCounts", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidPipelineProgressContractComparator:
    """Compare UID pipeline progress payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidPipelineProgressSummary | None = None):
        self.summary = summary or UidPipelineProgressSummary()

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
