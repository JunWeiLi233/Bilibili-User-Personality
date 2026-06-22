from __future__ import annotations

import argparse
import json
from pathlib import Path
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


class UidParallelProgressContractComparator:
    """Compare UID parallel progress reports using the JS/Python summary contract."""

    def __init__(self, summary: UidParallelProgressSummary | None = None):
        self.summary = summary or UidParallelProgressSummary()

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


class UidParallelProgressRunner:
    """Summarize one uidParallelAnalyzer.js worker progress JSON file."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        worker_id: int = 0,
        total_workers: int = 4,
        comments_file: str = "uid-discovery-comments.json",
        user_db_file: str = "scraped-users-db.json",
    ):
        self.data_dir = Path(data_dir)
        self.worker_id = int(worker_id)
        self.total_workers = max(1, int(total_workers))
        self.comments_path = self.data_dir / comments_file
        self.user_db_path = self.data_dir / user_db_file
        self.progress_path = self.data_dir / f"uid-parallel-{self.worker_id}-progress.json"

    def run(self) -> dict[str, Any]:
        all_comments = self._read_json(self.comments_path, {})
        progress = self._read_json(self.progress_path, {})
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        reporter = UidParallelProgressReporter(worker_id=self.worker_id, total_workers=self.total_workers)
        return reporter.build_report(all_comments, progress, users)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidParallelProgressPayloadContractComparator:
    """Compare file-backed UID parallel progress summaries against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options
        self.summary = UidParallelProgressSummary()
        self.comparator = UidParallelProgressContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidParallelProgressRunner(self.data_dir, **self.runner_options).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidParallelProgressRequest:
    """Scraper-layer request for UID parallel progress JSON contract commands."""

    def __init__(self, data_dir: str | Path, compare_js_report_path: str | Path | None = None, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.runner_options = runner_options

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return UidParallelProgressPayloadContractComparator(
                self.data_dir,
                self.compare_js_report_path,
                **self.runner_options,
            ).compare()
        return UidParallelProgressRunner(self.data_dir, **self.runner_options).run()


class UidParallelProgressCommandRequest:
    """Argv-backed scraper-layer request for UID parallel progress contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Summarize one UID parallel analyzer worker progress JSON file.")
        parser.add_argument("--data-dir", default="server/data")
        parser.add_argument("--worker", type=int, default=0)
        parser.add_argument("--workers", type=int, default=4)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID parallel progress report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return UidParallelProgressRequest(
            args.data_dir,
            compare_js_report_path=args.compare_js_report or None,
            worker_id=args.worker,
            total_workers=args.workers,
        ).run()


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


class UidParallelPlanRunner:
    """Read a JS-compatible uidParallelAnalyzer payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return UidParallelAnalyzerPlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidParallelPlanPayloadContractComparator:
    """Compare file-backed UID parallel dry-run plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = UidParallelPlanSummary()
        self.comparator = UidParallelPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidParallelPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class UidParallelPlanRequest:
    """Scraper-layer request for UID parallel plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return UidParallelPlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return UidParallelPlanRunner(self.payload_path).run()


class UidParallelPlanCommandRequest:
    """Argv-backed scraper-layer request for UID parallel plan contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a uidParallelAnalyzer.js-compatible dry-run plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID parallel plan report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return UidParallelPlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()
