from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _parse_int(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class BatchPopularScrapePlanner:
    """Build a dry-run plan for batchScrapePopular.js popular-video scanning."""

    DEFAULT_MAX_PAGES = 50
    POPULAR_PAGE_SIZE = 20
    REPLY_PAGES_PER_VIDEO = 10
    REPLY_PAGE_SIZE = 20
    DELAY_MS = 3000
    DELAY_AFTER_LIMIT_MS = 60000
    MAX_RETRIES = 5
    RATE_LIMIT_CODES = (-799, -412)

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
        max_pages = self.DEFAULT_MAX_PAGES
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--pages="):
                max_pages = _parse_int(arg.split("=", 1)[1], max_pages)
        pages_scanned = _parse_int(progress.get("pagesScanned"), 0)
        videos_scanned = _parse_int(progress.get("videosScanned"), 0)
        scraped = _parse_int(progress.get("scraped"), 0)
        start_page = pages_scanned + 1
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        return {
            "ok": True,
            "input": {"maxPages": max_pages},
            "range": {"startPage": start_page, "maxPages": max_pages, "remainingPages": max(0, max_pages - start_page + 1)},
            "progress": {"pagesScanned": pages_scanned, "videosScanned": videos_scanned, "scraped": scraped},
            "database": {"users": len(users)},
            "limits": {
                "popularPageSize": self.POPULAR_PAGE_SIZE,
                "replyPagesPerVideo": self.REPLY_PAGES_PER_VIDEO,
                "replyPageSize": self.REPLY_PAGE_SIZE,
            },
            "pacing": {"delayMs": self.DELAY_MS, "delayAfterLimitMs": self.DELAY_AFTER_LIMIT_MS, "maxRetries": self.MAX_RETRIES},
            "retry": {
                "rateLimitCodes": list(self.RATE_LIMIT_CODES),
                "htmlWafDetection": True,
                "hasUserAgent": True,
                "referer": "https://www.bilibili.com/",
            },
            "collection": {
                "storesTopLevelReplies": True,
                "storesNestedReplies": True,
                "dedupesByRpid": True,
                "updatesCombinedTextFromComments": True,
            },
            "sampleRequests": {
                "popularUrl": f"https://api.bilibili.com/x/web-interface/popular?ps={self.POPULAR_PAGE_SIZE}&pn={start_page}",
                "replyUrl": "https://api.bilibili.com/x/v2/reply?type=1&oid=123&pn=1&ps=20&sort=1",
            },
        }


class BatchPopularPlanSummary:
    """Shape batch popular dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("input", "range", "progress", "database", "limits", "pacing", "retry", "collection", "sampleRequests")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BatchPopularPlanRunner:
    """Read a JS-compatible batchScrapePopular payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return BatchPopularScrapePlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BatchPopularPlanContractComparator:
    """Compare batch popular plan payloads using the JS/Python summary contract."""

    def __init__(self, summary: BatchPopularPlanSummary | None = None):
        self.summary = summary or BatchPopularPlanSummary()

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


class BatchPopularPlanPayloadContractComparator:
    """Compare popular-video payload plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BatchPopularPlanSummary()
        self.comparator = BatchPopularPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BatchPopularPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BatchPopularPlanRequest:
    """Scraper-layer request for batch popular plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return BatchPopularPlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return BatchPopularPlanRunner(self.payload_path).run()
