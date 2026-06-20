from __future__ import annotations

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
