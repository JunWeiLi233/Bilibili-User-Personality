from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import safe_read_json_object


RANGE_LAUNCHER_RANGES = (
    {"start": 1, "end": 20000, "progressFile": "uid-range-progress-1-20000.json"},
    {"start": 20001, "end": 40000, "progressFile": "uid-range-progress-20001-40000.json"},
    {"start": 40001, "end": 60000, "progressFile": "uid-range-progress-40001-60000.json"},
    {"start": 60001, "end": 80000, "progressFile": "uid-range-progress-60001-80000.json"},
    {"start": 80001, "end": 100000, "progressFile": "uid-range-progress-80001-100000.json"},
)


def _js_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed or fallback


def _progress_number_or(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class BatchUidRangePlanner:
    """Build a dry-run plan for batchUidRange.js discovery and analysis phases."""

    DEFAULT_START = 200000
    DEFAULT_END = 300000
    DEFAULT_PAGES = 200
    POPULAR_PAGE_SIZE = 20
    COMMENT_PAGES_PER_VIDEO = 3
    DELAY_BETWEEN_VIDEOS_MS = 2000
    DELAY_BETWEEN_UIDS_MS = 1500
    LOCK_RETRY_DELAY_MS = 3000
    LOCK_MAX_RETRIES = 10
    SAVE_INTERVAL = 5

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
        start = self.DEFAULT_START
        end = self.DEFAULT_END
        pages = self.DEFAULT_PAGES
        phase2_only = False
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                start = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_START)
            elif arg.startswith("--end="):
                end = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_END)
            elif arg.startswith("--pages="):
                pages = _js_number_or(arg.split("=", 1)[1], self.DEFAULT_PAGES)
            elif arg == "--phase2-only":
                phase2_only = True

        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        scanned_bvids = progress.get("scannedBvids") if isinstance(progress.get("scannedBvids"), list) else []
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        target_uids = [uid for uid in uid_comments if self._uid_in_range(uid, start, end)]
        processed_targets = sum(1 for uid in target_uids if uid in processed_uids)
        normalized_stats = {
            "videosScanned": _js_number_or(stats.get("videosScanned"), 0) if stats.get("videosScanned") else 0,
            "uidsFound": _js_number_or(stats.get("uidsFound"), len(uid_comments)) if stats.get("uidsFound") else len(uid_comments),
            "targetUidsFound": _js_number_or(stats.get("targetUidsFound"), len(target_uids)) if stats.get("targetUidsFound") else len(target_uids),
            "commentsCollected": _js_number_or(stats.get("commentsCollected"), 0) if stats.get("commentsCollected") else 0,
            "analyzed": _js_number_or(stats.get("analyzed"), 0) if stats.get("analyzed") else 0,
            "skipped": _js_number_or(stats.get("skipped"), 0) if stats.get("skipped") else 0,
            "errors": _js_number_or(stats.get("errors"), 0) if stats.get("errors") else 0,
        }
        return {
            "ok": True,
            "input": {"start": start, "end": end, "pages": pages, "phase2Only": phase2_only},
            "phase1": {
                "enabled": not phase2_only,
                "scannedBvids": len(scanned_bvids),
                "maxPages": pages,
                "popularPageSize": self.POPULAR_PAGE_SIZE,
                "commentPagesPerVideo": self.COMMENT_PAGES_PER_VIDEO,
            },
            "phase2": {"targetUids": len(target_uids), "processed": processed_targets, "remaining": max(0, len(target_uids) - processed_targets), "userDbUsers": len(users)},
            "stats": normalized_stats,
            "pacing": {
                "delayBetweenVideosMs": self.DELAY_BETWEEN_VIDEOS_MS,
                "delayBetweenUidsMs": self.DELAY_BETWEEN_UIDS_MS,
                "lockRetryDelayMs": self.LOCK_RETRY_DELAY_MS,
                "lockMaxRetries": self.LOCK_MAX_RETRIES,
                "saveInterval": self.SAVE_INTERVAL,
            },
        }

    def _uid_in_range(self, uid: Any, start: int, end: int) -> bool:
        try:
            value = int(float(str(uid)))
        except (TypeError, ValueError):
            return False
        return start <= value <= end


class BatchUidRangePlanSummary:
    """Shape batch UID range dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("input", "phase1", "phase2", "stats", "pacing")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BatchUidRangePlanRunner:
    """Read a JS-compatible batchUidRange payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return BatchUidRangePlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BatchUidRangePlanContractComparator:
    """Compare batch UID range plan payloads using the JS/Python summary contract."""

    def __init__(self, summary: BatchUidRangePlanSummary | None = None):
        self.summary = summary or BatchUidRangePlanSummary()

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


class BatchUidRangePlanPayloadContractComparator:
    """Compare batch UID range payload plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BatchUidRangePlanSummary()
        self.comparator = BatchUidRangePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BatchUidRangePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class BatchUidRangePlanRequest:
    """Scraper-layer request for batch UID range plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return BatchUidRangePlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return BatchUidRangePlanRunner(self.payload_path).run()


class BatchUidRangePlanCommandRequest:
    """Argv-backed scraper-layer request for batch UID range plan contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a batchUidRange.js-compatible dry-run plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch UID range plan report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BatchUidRangePlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


class RangeScraperLauncherPlanner:
    """Build a dry-run launch plan compatible with launchRangeScrapers.ps1."""

    def build_plan(
        self,
        *,
        data_dir: str | Path,
        script: str = "server/scripts/uidRangeScrape.js",
        launch_delay_seconds: int = 3,
    ) -> dict[str, Any]:
        data_dir = Path(data_dir)
        launch_delay_seconds = int(launch_delay_seconds)
        workers = []
        for item in RANGE_LAUNCHER_RANGES:
            start = int(item["start"])
            end = int(item["end"])
            progress_file = str(item["progressFile"])
            log_name = f"uid-range-{start}-{end}.log"
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": f"scraper-logs/{log_name}",
                    "stderrFile": f"scraper-logs/{log_name.replace('.log', '-stderr.log')}",
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
            "summary": {
                "workers": len(workers),
                "totalStart": total_start,
                "totalEnd": total_end,
                "totalUids": total_uids,
                "launchDelaySeconds": launch_delay_seconds,
            },
        }


class RangeScraperLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchRangeScrapers.ps1."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        script: str = "server/scripts/uidRangeScrape.js",
        launch_delay_seconds: int = 3,
    ):
        self.data_dir = Path(data_dir)
        self.script = script
        self.launch_delay_seconds = int(launch_delay_seconds)

    def run(self) -> dict[str, Any]:
        return RangeScraperLauncherPlanner().build_plan(
            data_dir=self.data_dir,
            script=self.script,
            launch_delay_seconds=self.launch_delay_seconds,
        )


class RangeScraperLauncherSummary:
    """Shape range scraper launcher plans into the JS/Python comparator summary contract."""

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


class RangeScraperLauncherContractComparator:
    """Compare range scraper launcher payloads with the shared JS/Python contract."""

    def __init__(self, summary: RangeScraperLauncherSummary | None = None):
        self.summary = summary or RangeScraperLauncherSummary()

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


class RangeScraperLauncherPayloadContractComparator:
    """Compare range scraper launcher plans against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.summary = RangeScraperLauncherSummary()
        self.comparator = RangeScraperLauncherContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = RangeScraperLauncherPlanRunner(self.data_dir).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class RangeScraperLauncherRequest:
    """Scraper-layer request for range scraper launcher JSON contract commands."""

    def __init__(self, data_dir: str | Path, compare_js_report_path: str | Path | None = None):
        self.data_dir = Path(data_dir)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return RangeScraperLauncherPayloadContractComparator(self.data_dir, self.compare_js_report_path).compare()
        return RangeScraperLauncherPlanRunner(self.data_dir).run()


class RangeScraperLauncherCommandRequest:
    """Argv-backed scraper-layer request for range scraper launcher contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a dry-run UID range scraper launcher plan.")
        parser.add_argument("--data-dir", default="server/data")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible range launcher report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return RangeScraperLauncherRequest(args.data_dir, compare_js_report_path=args.compare_js_report or None).run()


class UidRangeProgressReporter:
    """Summarize batch UID range progress payloads into the JS-compatible report shape."""

    def __init__(self, *, start: int = 200000, end: int = 300000):
        self.start = int(start)
        self.end = int(end)

    def build_report(self, payload: Any) -> dict[str, Any]:
        progress = payload if isinstance(payload, dict) else {}
        uid_comments = progress.get("_uidComments") if isinstance(progress.get("_uidComments"), dict) else {}
        processed_uids = progress.get("processedUids") if isinstance(progress.get("processedUids"), dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        target_uids = [uid for uid in uid_comments if self._in_range(uid)]
        processed_target_uids = {uid: status for uid, status in processed_uids.items() if self._in_range(uid)}
        success_count = sum(1 for status in processed_target_uids.values() if status == "success")
        error_count = sum(1 for status in processed_target_uids.values() if str(status).startswith("error"))
        target_comment_total = sum(len(comments) for uid, comments in uid_comments.items() if self._in_range(uid) and isinstance(comments, list))
        target_count = len(target_uids)
        return {
            "ok": True,
            "range": {"start": self.start, "end": self.end},
            "discovery": {
                "videosScanned": _progress_number_or(stats.get("videosScanned"), len(progress.get("scannedBvids") or [])) if stats.get("videosScanned") else len(progress.get("scannedBvids") or []),
                "uidsDiscovered": len(uid_comments),
                "targetUidsDiscovered": _progress_number_or(stats.get("targetUidsFound"), target_count) if stats.get("targetUidsFound") else target_count,
                "commentsCollected": _progress_number_or(stats.get("commentsCollected"), 0) if stats.get("commentsCollected") else 0,
            },
            "phase2": {
                "processed": len(processed_target_uids),
                "success": success_count,
                "errors": error_count,
                "skipped": _progress_number_or(stats.get("skipped"), 0) if stats.get("skipped") else 0,
                "remaining": max(0, target_count - len(processed_target_uids)),
            },
            "comments": {
                "totalForTargetUids": target_comment_total,
                "averagePerTargetUid": round(target_comment_total / target_count, 2) if target_count else 0,
            },
            "lastUpdated": progress.get("lastUpdated") or None,
        }

    def _in_range(self, uid: Any) -> bool:
        try:
            value = int(str(uid))
        except ValueError:
            return False
        return self.start <= value <= self.end


class UidRangeProgressRunner:
    """Summarize batchUidRange.js progress JSON without mutating scraper state."""

    def __init__(self, progress_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.start = int(start)
        self.end = int(end)

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.progress_path, {})
        return UidRangeProgressReporter(start=self.start, end=self.end).build_report(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidRangeProgressSummary:
    """Shape UID range progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "discovery", "phase2", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidRangeProgressContractComparator:
    """Compare UID range progress reports using the JS/Python summary contract."""

    def __init__(self, summary: UidRangeProgressSummary | None = None):
        self.summary = summary or UidRangeProgressSummary()

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


class UidRangeProgressPayloadContractComparator:
    """Compare UID range progress reports against saved JS-compatible JSON."""

    def __init__(self, progress_path: str | Path, js_report_path: str | Path, *, start: int = 200000, end: int = 300000):
        self.progress_path = Path(progress_path)
        self.js_report_path = Path(js_report_path)
        self.start = start
        self.end = end
        self.summary = UidRangeProgressSummary()
        self.comparator = UidRangeProgressContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidRangeProgressRunner(self.progress_path, start=self.start, end=self.end).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class UidRangeProgressRequest:
    """Scraper-layer request for UID range progress JSON contract commands."""

    def __init__(
        self,
        progress_path: str | Path,
        compare_js_report_path: str | Path | None = None,
        *,
        start: int = 200000,
        end: int = 300000,
    ):
        self.progress_path = Path(progress_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.start = int(start)
        self.end = int(end)

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return UidRangeProgressPayloadContractComparator(
                self.progress_path,
                self.compare_js_report_path,
                start=self.start,
                end=self.end,
            ).compare()
        return UidRangeProgressRunner(self.progress_path, start=self.start, end=self.end).run()


class UidRangeProgressCommandRequest:
    """Argv-backed scraper-layer request for UID range progress contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Summarize batch UID range progress JSON.")
        parser.add_argument("--progress", default="server/data/batch-uid-range-progress.json")
        parser.add_argument("--start", type=int, default=200000)
        parser.add_argument("--end", type=int, default=300000)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID range report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return UidRangeProgressRequest(
            args.progress,
            compare_js_report_path=args.compare_js_report or None,
            start=args.start,
            end=args.end,
        ).run()
