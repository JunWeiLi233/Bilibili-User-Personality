from __future__ import annotations

from typing import Any


def _parse_int(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class BatchBilibiliScrapePlanner:
    """Build a dry-run plan for batchScrapeBilibili.js UID range routing."""

    DELAY_BETWEEN_REQUESTS_MS = 3000
    DELAY_BETWEEN_UIDS_MS = 15000
    DELAY_AFTER_RATE_LIMIT_MS = 60000
    MAX_RETRIES = 3
    MAX_VIDEOS = 3
    MAX_COMMENTS = 50
    VIDEO_REPLY_PAGES = 1
    BROWSER_TIMEOUT_MS = 45000
    RATE_LIMIT_CODES = (-799, -412)
    BROWSER_COMMAND = "browser-harness"
    BROWSER_SCRIPT = "server/scripts/browserGetVideos.py"
    BROWSER_WRAPPER = "server/data/_browser_tmp.py"

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
        start_uid = 100000
        end_uid = 200000
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                start_uid = _parse_int(arg.split("=", 1)[1], start_uid)
            elif arg.startswith("--end="):
                end_uid = _parse_int(arg.split("=", 1)[1], end_uid)
        if start_uid <= 0:
            start_uid = 100000
        if end_uid <= 0:
            end_uid = 200000
        input_start = start_uid
        last_uid = _parse_int(progress.get("lastUid"), 0)
        resumed = last_uid >= start_uid
        if resumed:
            start_uid = last_uid + 1
        total = max(0, end_uid - start_uid + 1)
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        return {
            "ok": True,
            "input": {"startUid": input_start, "endUid": end_uid},
            "range": {"startUid": start_uid, "endUid": end_uid, "total": total},
            "resume": {"lastUid": last_uid, "resumed": resumed},
            "database": {"users": len(users)},
            "limits": {"maxVideos": self.MAX_VIDEOS, "maxComments": self.MAX_COMMENTS, "replyPages": self.VIDEO_REPLY_PAGES},
            "pacing": {
                "delayBetweenRequestsMs": self.DELAY_BETWEEN_REQUESTS_MS,
                "delayBetweenUidsMs": self.DELAY_BETWEEN_UIDS_MS,
                "delayAfterRateLimitMs": self.DELAY_AFTER_RATE_LIMIT_MS,
            },
            "retry": {
                "maxRetries": self.MAX_RETRIES,
                "rateLimitCodes": list(self.RATE_LIMIT_CODES),
                "htmlWafDetection": True,
                "hasUserAgent": True,
                "referer": "https://www.bilibili.com/",
            },
            "browser": {
                "command": self.BROWSER_COMMAND,
                "script": self.BROWSER_SCRIPT,
                "wrapper": self.BROWSER_WRAPPER,
                "timeoutMs": self.BROWSER_TIMEOUT_MS,
                "maxVideos": self.MAX_VIDEOS,
            },
            "sampleRequests": self._sample_requests(str(start_uid) if total else ""),
            "progress": {
                "completed": _parse_int(progress.get("completed"), 0),
                "errors": len(progress.get("errors") if isinstance(progress.get("errors"), list) else []),
            },
        }

    def _sample_requests(self, uid: str) -> dict[str, Any]:
        return {
            "uid": uid,
            "cardUrl": f"https://api.bilibili.com/x/web-interface/card?mid={uid}" if uid else "",
            "replyUrl": "https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1" if uid else "",
            "wrapperArgv": ["browserGetVideos.py", uid, str(self.MAX_VIDEOS)] if uid else [],
        }


class BatchBilibiliPlanSummary:
    """Shape batch Bilibili dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("input", "range", "resume", "database", "limits", "pacing", "retry", "browser", "sampleRequests", "progress")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BatchBilibiliPlanContractComparator:
    """Compare batch Bilibili plan payloads using the JS/Python summary contract."""

    def __init__(self, summary: BatchBilibiliPlanSummary | None = None):
        self.summary = summary or BatchBilibiliPlanSummary()

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
