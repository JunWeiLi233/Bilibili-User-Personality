from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


def _parse_int(value: Any, fallback: int) -> int:
    text = str(value if value is not None else "").strip()
    match = re.match(r"^[+-]?\d+", text)
    if not match:
        return fallback
    try:
        return int(match.group(0))
    except ValueError:
        return fallback


def _js_object_key_count(value: Any) -> int:
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, list):
        return len(value)
    return 0


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
        index = 0
        while index < len(argv):
            raw = argv[index]
            arg = str(raw or "")
            if arg.startswith("--start="):
                start_uid = _parse_int(arg.split("=", 1)[1], start_uid)
            elif arg == "--start" and index + 1 < len(argv):
                index += 1
                start_uid = _parse_int(argv[index], start_uid)
            elif arg.startswith("--end="):
                end_uid = _parse_int(arg.split("=", 1)[1], end_uid)
            elif arg == "--end" and index + 1 < len(argv):
                index += 1
                end_uid = _parse_int(argv[index], end_uid)
            index += 1
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
        users = database.get("users")
        return {
            "ok": True,
            "input": {"startUid": input_start, "endUid": end_uid},
            "range": {"startUid": start_uid, "endUid": end_uid, "total": total},
            "resume": {"lastUid": last_uid, "resumed": resumed},
            "database": {"users": _js_object_key_count(users)},
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


class BatchBilibiliPlanRunner:
    """Read a JS-compatible batchScrapeBilibili payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return BatchBilibiliScrapePlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


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


class BatchBilibiliPlanPayloadContractComparator:
    """Compare batch Bilibili payload plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BatchBilibiliPlanSummary()
        self.comparator = BatchBilibiliPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BatchBilibiliPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class BatchBilibiliPlanRequest:
    """Scraper-layer request for batch Bilibili plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return BatchBilibiliPlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return BatchBilibiliPlanRunner(self.payload_path).run()


class BatchBilibiliPlanCommandRequest:
    """Argv-backed scraper-layer request for batch Bilibili plan contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a batchScrapeBilibili.js-compatible dry-run UID range plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch Bilibili plan report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BatchBilibiliPlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()
