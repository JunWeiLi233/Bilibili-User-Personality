from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _parse_int_or(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class AicuBrowserBatchPlanner:
    """Build a dry-run plan for batchScrapeAicuBrowser.js browser-backed UID scraping."""

    DEFAULT_START_UID = 100000
    DEFAULT_END_UID = 200000
    DELAY_BETWEEN_UIDS_MS = 5000
    MAX_PAGES = 3
    TIMEOUT_MS = 120000
    SAVE_EVERY_ATTEMPTS = 10
    BROWSER_COMMAND = "browser-harness"
    SCRIPT_PATH = "server/scripts/browserScrapeAicu.py"
    WRAPPER_PATH = "server/data/_browser_aicu_tmp.py"

    def __init__(self, *, project_dir: str = ""):
        self.project_dir = project_dir

    @classmethod
    def build_plan_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        planner = cls(project_dir=str(payload.get("projectDir") or payload.get("project_dir") or ""))
        return planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            progress=payload.get("progress") if isinstance(payload.get("progress"), dict) else {},
            database=payload.get("database") if isinstance(payload.get("database"), dict) else {},
        )

    def build_plan(self, argv: list[Any] | None = None, progress: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        progress = progress or {}
        database = database or {}
        options = self._parse_args(argv)
        requested_start = options["start"]
        end_uid = options["end"]
        last_uid = _parse_int_or(progress.get("lastUid"), 0)
        effective_start = last_uid + 1 if last_uid >= requested_start else requested_start
        total = max(0, end_uid - effective_start + 1)
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        sample_uid = str(effective_start) if total else ""
        return {
            "ok": True,
            "range": {"requestedStart": requested_start, "effectiveStart": effective_start, "end": end_uid, "total": total},
            "progress": {
                "lastUid": last_uid,
                "completed": _parse_int_or(progress.get("completed"), 0),
                "errors": len(progress.get("errors")) if isinstance(progress.get("errors"), list) else 0,
            },
            "database": {"users": len(users), "existingInEffectiveRange": self._users_in_range(users, effective_start, end_uid)},
            "browser": {
                "command": self.BROWSER_COMMAND,
                "script": self.SCRIPT_PATH,
                "wrapper": self.WRAPPER_PATH,
                "timeoutMs": self.TIMEOUT_MS,
                "maxPages": self.MAX_PAGES,
            },
            "pacing": {"delayBetweenUidsMs": self.DELAY_BETWEEN_UIDS_MS, "saveEveryAttempts": self.SAVE_EVERY_ATTEMPTS},
            "sampleInvocation": self._sample_invocation(sample_uid),
        }

    def _parse_args(self, argv: list[Any]) -> dict[str, int]:
        options = {"start": self.DEFAULT_START_UID, "end": self.DEFAULT_END_UID}
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                options["start"] = _parse_int_or(arg.split("=", 1)[1], self.DEFAULT_START_UID)
            elif arg.startswith("--end="):
                options["end"] = _parse_int_or(arg.split("=", 1)[1], self.DEFAULT_END_UID)
        return options

    def _users_in_range(self, users: dict[str, Any], start: int, end: int) -> int:
        count = 0
        for uid in users:
            numeric_uid = _parse_int_or(uid, -1)
            if start <= numeric_uid <= end:
                count += 1
        return count

    def _sample_invocation(self, uid: str) -> dict[str, Any]:
        return {
            "uid": uid,
            "wrapperArgv": ["browserScrapeAicu.py", uid, str(self.MAX_PAGES)] if uid else [],
            "exec": f"{self.BROWSER_COMMAND} -c \"exec(open('{self.WRAPPER_PATH}').read())\"",
        }


class AicuBrowserBatchPlanSummary:
    """Shape AICU browser batch dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "progress", "database", "browser", "pacing", "sampleInvocation")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class AicuBrowserBatchPlanRunner:
    """Read a JS-compatible batchScrapeAicuBrowser payload and emit a dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return AicuBrowserBatchPlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("AICU browser batch plan payload must be a JSON object.")
        return payload


class AicuBrowserBatchPlanContractComparator:
    """Compare AICU browser batch plans using the JS/Python summary contract."""

    def __init__(self, summary: AicuBrowserBatchPlanSummary | None = None):
        self.summary = summary or AicuBrowserBatchPlanSummary()

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


class AicuBrowserBatchPlanPayloadContractComparator:
    """Compare AICU browser batch payload plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = AicuBrowserBatchPlanSummary()
        self.comparator = AicuBrowserBatchPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = AicuBrowserBatchPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
