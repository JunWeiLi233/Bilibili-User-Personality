from __future__ import annotations

import json
from pathlib import Path
from typing import Any


STAT_KEYS = ("success", "noComments", "noVideos", "noUser", "trainError", "blocked", "errors")
FAST_LAUNCHER_RANGES = (
    {"start": 1, "end": 20000},
    {"start": 20001, "end": 40000},
    {"start": 40001, "end": 60000},
    {"start": 60001, "end": 80000},
    {"start": 80001, "end": 100000},
)


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


class UidFastPipelinePlanSummary:
    """Shape UID fast pipeline plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "progress", "limits", "network", "pacing", "training", "blockPolicy", "stats", "userDb")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class UidFastPipelinePlanContractComparator:
    """Compare UID fast pipeline plan payloads with the shared JS/Python contract."""

    def __init__(self, summary: UidFastPipelinePlanSummary | None = None):
        self.summary = summary or UidFastPipelinePlanSummary()

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


class UidFastPipelinePlanRunner:
    """Read a JS-compatible uidPipelineFast payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return UidFastPipelinePlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("UID fast pipeline plan payload must be a JSON object.")
        return payload


class UidFastPipelinePlanPayloadContractComparator:
    """Compare Python UID fast pipeline dry-run plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = UidFastPipelinePlanSummary()
        self.comparator = UidFastPipelinePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = UidFastPipelinePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class FastPipelineLauncherPlanner:
    """Build a dry-run launch plan compatible with launchFastWorkers.ps1."""

    def build_plan(
        self,
        *,
        data_dir: str | Path,
        script: str = "server/scripts/uidPipelineFast.js",
        launch_delay_seconds: int = 5,
    ) -> dict[str, Any]:
        data_dir = Path(data_dir)
        launch_delay_seconds = int(launch_delay_seconds)
        workers = []
        for item in FAST_LAUNCHER_RANGES:
            start = int(item["start"])
            end = int(item["end"])
            progress_file = f"uid-pipeline-fast-{start}-{end}.json"
            log_name = f"uid-pipeline-fast-{start}-{end}.log"
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": f"scraper-logs/{log_name}",
                    "stderrFile": f"scraper-logs/{log_name.replace('.log', '-stderr.log')}",
                    "cmdArgs": f'/c node "{script}" --start={start} --end={end}',
                    "args": [f"--start={start}", f"--end={end}"],
                }
            )

        total_start = workers[0]["start"] if workers else 0
        total_end = workers[-1]["end"] if workers else 0
        total_uids = sum(worker["end"] - worker["start"] + 1 for worker in workers)
        return {
            "ok": True,
            "script": script,
            "shell": "cmd",
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


class FastPipelineLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchFastWorkers.ps1."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        script: str = "server/scripts/uidPipelineFast.js",
        launch_delay_seconds: int = 5,
    ):
        self.data_dir = Path(data_dir)
        self.script = script
        self.launch_delay_seconds = int(launch_delay_seconds)

    def run(self) -> dict[str, Any]:
        return FastPipelineLauncherPlanner().build_plan(
            data_dir=self.data_dir,
            script=self.script,
            launch_delay_seconds=self.launch_delay_seconds,
        )


class FastPipelineLauncherSummary:
    """Shape fast pipeline launcher plans into the JS/Python comparator summary contract."""

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


class FastPipelineLauncherContractComparator:
    """Compare fast pipeline launcher payloads with the shared JS/Python contract."""

    def __init__(self, summary: FastPipelineLauncherSummary | None = None):
        self.summary = summary or FastPipelineLauncherSummary()

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


class FastPipelineLauncherPayloadContractComparator:
    """Compare fast pipeline launcher plans against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.summary = FastPipelineLauncherSummary()
        self.comparator = FastPipelineLauncherContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = FastPipelineLauncherPlanRunner(self.data_dir).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
