from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


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


class UidPipelinePlanRunner:
    """Read a JS-compatible uidPipelineWorker payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return UidPipelineWorkerPlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidPipelinePlanPayloadContractComparator:
    """Compare file-backed UID pipeline dry-run plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = UidPipelinePlanSummary()
        self.comparator = UidPipelinePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelinePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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


class UidPipelineLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchUidPipeline.js state JSON."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        write_state: bool = False,
        now: Callable[[], str] | None = None,
    ):
        self.data_dir = Path(data_dir)
        self.total_start = int(total_start)
        self.total_end = int(total_end)
        self.workers = max(1, int(workers))
        self.write_state = write_state
        self.now = now

    def run(self) -> dict[str, Any]:
        result = UidPipelineLauncherPlanner(now=self.now).build_plan(total_start=self.total_start, total_end=self.total_end, workers=self.workers)
        if self.write_state:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            (self.data_dir / "uid-pipeline-launcher.json").write_text(json.dumps(result["state"], ensure_ascii=False, indent=2), encoding="utf-8")

        return {**result, "statePath": str(self.data_dir / "uid-pipeline-launcher.json"), "writeState": self.write_state}


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


class UidPipelineLauncherContractComparator:
    """Compare UID pipeline launcher payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidPipelineLauncherSummary | None = None):
        self.summary = summary or UidPipelineLauncherSummary()

    def compare(self, python_state: dict[str, Any] | None, js_state: dict[str, Any] | None) -> dict[str, Any]:
        python_state = python_state if isinstance(python_state, dict) else {}
        js_state = js_state if isinstance(js_state, dict) else {}
        python_summary = self.summary.summarize(python_state)
        js_summary = self.summary.summarize(js_state)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {"startedAt": python_state.get("startedAt"), **python_summary},
            "js": {"startedAt": js_state.get("startedAt"), **js_summary} if "startedAt" in js_state else js_summary,
        }


class UidPipelineLauncherPayloadContractComparator:
    """Compare the Python dry-run launcher state against JS launcher state JSON."""

    def __init__(
        self,
        data_dir: str | Path,
        js_report_path: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
    ):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.total_start = total_start
        self.total_end = total_end
        self.workers = workers
        self.summary = UidPipelineLauncherSummary()
        self.comparator = UidPipelineLauncherContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_state = UidPipelineLauncherPlanRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            now=lambda: "",
        ).run()["state"]
        js_state = self._read_js_report()
        return self.comparator.compare(python_state, js_state)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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


class UidPipelineMergeContractComparator:
    """Compare UID pipeline merge payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidPipelineMergeSummary | None = None):
        self.summary = summary or UidPipelineMergeSummary()

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


class UidPipelineMergeRunner:
    """Build a Python dry-run merge report for UID pipeline worker progress files."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        summary_only: bool = False,
        now: Any | None = None,
    ):
        self.data_dir = Path(data_dir)
        self.total_start = int(total_start)
        self.total_end = int(total_end)
        self.workers = max(1, int(workers))
        self.summary_only = summary_only
        self.now = now

    def run(self) -> dict[str, Any]:
        total_expected = max(0, self.total_end - self.total_start + 1)
        chunk_size = math.ceil(total_expected / self.workers) if total_expected else 0
        chunks = []
        for worker_index in range(self.workers):
            start = self.total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, self.total_end)
            if start > self.total_end:
                break
            progress_path = self.data_dir / f"uid-pipeline-{start}-{end}.json"
            progress = self._read_json(progress_path, {"processed": {}, "stats": {}})
            chunks.append({"start": start, "end": end, "path": str(progress_path), "progress": progress})
        user_db = self._read_json(self.data_dir / "scraped-users-db.json", {"users": {}})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        return UidPipelineMergeReporter(now=self.now).build_report(
            chunks,
            users=users,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            chunk_size=chunk_size,
            summary_only=self.summary_only,
        )

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidPipelineMergePayloadContractComparator:
    """Compare file-backed Python UID merge reports against saved JS-compatible JSON."""

    def __init__(
        self,
        data_dir: str | Path,
        js_report_path: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
    ):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.total_start = total_start
        self.total_end = total_end
        self.workers = workers
        self.summary = UidPipelineMergeSummary()
        self.comparator = UidPipelineMergeContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineMergeRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            now=lambda: "",
        ).run()
        python_result.pop("lastUpdated", None)
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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


class UidPipelineStateRunner:
    """Summarize live launchUidPipeline.js state and referenced worker progress files."""

    def __init__(self, data_dir: str | Path, *, state_file: str = "uid-pipeline-launcher.json"):
        self.data_dir = Path(data_dir)
        self.state_path = self.data_dir / state_file

    def run(self) -> dict[str, Any]:
        state = self._read_json(self.state_path, {})
        progress_by_file = {}
        raw_workers = state.get("workers") if isinstance(state.get("workers"), list) else []
        for raw_worker in raw_workers:
            if not isinstance(raw_worker, dict):
                continue
            start = int(raw_worker.get("start") or 0)
            end = int(raw_worker.get("end") or 0)
            progress_file = str(raw_worker.get("progressFile") or f"uid-pipeline-{start}-{end}.json")
            progress_by_file[progress_file] = self._read_json(self.data_dir / progress_file, {})
        return UidPipelineStateReporter().build_report(state, progress_by_file)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


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


class UidPipelineStatePayloadContractComparator:
    """Compare Python live UID pipeline state summaries against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.summary = UidPipelineStateSummary()
        self.comparator = UidPipelineStateContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineStateRunner(self.data_dir).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidPipelineStateRequest:
    """Scraper-layer request for UID pipeline state JSON contract commands."""

    def __init__(self, data_dir: str | Path, compare_js_report_path: str | Path | None = None):
        self.data_dir = Path(data_dir)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return UidPipelineStatePayloadContractComparator(self.data_dir, self.compare_js_report_path).compare()
        return UidPipelineStateRunner(self.data_dir).run()


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


class UidPipelineProgressRunner:
    """Summarize one uidPipelineWorker.js progress JSON file without mutating it."""

    def __init__(
        self,
        progress_path: str | Path,
        *,
        start: int | None = None,
        end: int | None = None,
        user_db_path: str | Path | None = None,
    ):
        self.progress_path = Path(progress_path)
        inferred_start, inferred_end = self._infer_range(self.progress_path.name)
        self.start = int(start if start is not None else inferred_start)
        self.end = int(end if end is not None else inferred_end)
        self.user_db_path = Path(user_db_path) if user_db_path else self.progress_path.with_name("scraped-users-db.json")

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        return UidPipelineProgressReporter().build_report(payload, users=users, start=self.start, end=self.end)

    def _infer_range(self, name: str) -> tuple[int, int]:
        match = re.search(r"uid-pipeline-(\d+)-(\d+)\.json$", name)
        if not match:
            return 0, 0
        return int(match.group(1)), int(match.group(2))

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


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


class UidPipelineProgressPayloadContractComparator:
    """Compare one Python UID pipeline progress summary against saved JS-compatible JSON."""

    def __init__(self, progress_path: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options
        self.summary = UidPipelineProgressSummary()
        self.comparator = UidPipelineProgressContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineProgressRunner(self.progress_path, **self.runner_options).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidPipelineProgressRequest:
    """Scraper-layer request for UID pipeline progress JSON contract commands."""

    def __init__(self, progress_path: str | Path, compare_js_report_path: str | Path | None = None, **runner_options: Any):
        self.progress_path = Path(progress_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.runner_options = runner_options

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return UidPipelineProgressPayloadContractComparator(
                self.progress_path,
                self.compare_js_report_path,
                **self.runner_options,
            ).compare()
        return UidPipelineProgressRunner(self.progress_path, **self.runner_options).run()
