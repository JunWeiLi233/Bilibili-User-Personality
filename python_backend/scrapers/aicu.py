from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


AICU_COMMENTS_API = "https://api.aicu.cc/api/v3/search/getreply"
AICU_DANMAKU_API = "https://api.aicu.cc/api/v3/search/getvideodm"


def _parse_int_or(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class AicuScrapePlanSummary:
    """Shape AICU scrape request plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("uids", "summary", "requests")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class AicuScrapePlanContractComparator:
    """Compare AICU scrape plans using the JS/Python summary contract."""

    def __init__(self, summary: AicuScrapePlanSummary | None = None):
        self.summary = summary or AicuScrapePlanSummary()

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


class AicuScrapePlanner:
    """Build a read-only plan compatible with scrapeAicuUsers.js UID inputs."""

    def __init__(self, *, max_pages: int = 10, page_size: int = 20, delay_between_uids_ms: int = 15000):
        self.max_pages = _parse_int_or(max_pages, 10)
        self.page_size = _parse_int_or(page_size, 20)
        self.delay_between_uids_ms = _parse_int_or(delay_between_uids_ms, 15000)

    @classmethod
    def build_plan_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        argv = payload.get("argv") if isinstance(payload.get("argv"), list) else []
        max_pages = _parse_int_or(payload.get("maxPages") or payload.get("max_pages"), 10)
        page_size = _parse_int_or(payload.get("pageSize") or payload.get("page_size"), 20)
        delay_between_uids_ms = _parse_int_or(payload.get("delayBetweenUidsMs") or payload.get("delay_between_uids_ms"), 15000)
        return cls(
            max_pages=max_pages,
            page_size=page_size,
            delay_between_uids_ms=delay_between_uids_ms,
        ).build_plan([str(item) for item in argv], max_pages=max_pages)

    def build_plan(self, argv: list[str], *, max_pages: int | None = None) -> dict[str, Any]:
        pages = _parse_int_or(max_pages if max_pages is not None else self.max_pages, self.max_pages)
        uids = self.extract_uids(argv)
        return {
            "ok": bool(uids),
            "uids": uids,
            "requests": [self._request_plan(uid, pages) for uid in uids],
            "summary": {
                "uids": len(uids),
                "commentPagesPerUid": pages,
                "danmakuPagesPerUid": pages,
                "delayBetweenUidsMs": self.delay_between_uids_ms,
            },
        }

    def extract_uids(self, argv: list[str]) -> list[str]:
        values: list[str] = []
        index = 0
        while index < len(argv):
            arg = str(argv[index] or "").strip()
            if arg.startswith("--uid="):
                values.extend(self._uids_from_text(arg.split("=", 1)[1]))
            elif arg == "--uid" and index + 1 < len(argv):
                index += 1
                values.extend(self._uids_from_text(argv[index]))
            elif arg.startswith("--file="):
                values.extend(self._uids_from_file(arg.split("=", 1)[1]))
            elif arg == "--file" and index + 1 < len(argv):
                index += 1
                values.extend(self._uids_from_file(argv[index]))
            elif not arg.startswith("-"):
                values.extend(self._uids_from_text(arg))
            index += 1
        return self._dedupe(values)

    def _request_plan(self, uid: str, pages: int) -> dict[str, Any]:
        return {
            "uid": uid,
            "commentPages": pages,
            "danmakuPages": pages,
            "commentsUrl": f"{AICU_COMMENTS_API}?uid={uid}&pn=1&ps={self.page_size}&mode=0&keyword=",
            "danmakuUrl": f"{AICU_DANMAKU_API}?uid={uid}&pn=1&ps={self.page_size}&keyword=",
        }

    def _uids_from_file(self, file_path: str) -> list[str]:
        path = Path(str(file_path).strip())
        if not path.exists():
            return []
        return self._uids_from_text(path.read_text(encoding="utf-8-sig"))

    def _uids_from_text(self, text: Any) -> list[str]:
        values = []
        for token in re.split(r"[\s,;\uFF0C\uFF1B]+", str(text or "")):
            uid = self._extract_uid(token)
            if uid:
                values.append(uid)
        return values

    def _extract_uid(self, value: str) -> str | None:
        text = str(value or "").strip()
        space_match = re.search(r"space\.bilibili\.com/(\d+)", text)
        if space_match:
            return space_match.group(1)
        return text if re.fullmatch(r"\d+", text) else None

    def _dedupe(self, values: list[str]) -> list[str]:
        seen = set()
        result = []
        for value in values:
            if value not in seen:
                seen.add(value)
                result.append(value)
        return result


class AicuScrapePlanRunner:
    """Read a JS-compatible AICU scrape payload and emit a dry-run request plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return AicuScrapePlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class AicuScrapePlanPayloadContractComparator:
    """Compare AICU scrape payload plans against saved JS-compatible reports."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = AicuScrapePlanSummary()
        self.comparator = AicuScrapePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = AicuScrapePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class AicuScrapePlanRequest:
    """Scraper-layer request for AICU scrape plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return AicuScrapePlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return AicuScrapePlanRunner(self.payload_path).run()


class AicuBatchPlanner:
    """Build a dry-run plan for batchScrapeAicu.js range-based AICU scraping."""

    DEFAULT_START_UID = 100000
    DEFAULT_END_UID = 200000
    DELAY_BETWEEN_PAGES_MS = 10000
    DELAY_BETWEEN_UIDS_MS = 20000
    DELAY_AFTER_WAF_MS = 120000
    MAX_RETRIES = 3
    MAX_PAGES = 3
    PAGE_SIZE = 20
    SAVE_EVERY_ATTEMPTS = 5
    WAF_STATUSES = (429, 468, 1015)

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
            "limits": {"maxPages": self.MAX_PAGES, "pageSize": self.PAGE_SIZE, "saveEveryAttempts": self.SAVE_EVERY_ATTEMPTS},
            "pacing": {
                "delayBetweenPagesMs": self.DELAY_BETWEEN_PAGES_MS,
                "delayBetweenUidsMs": self.DELAY_BETWEEN_UIDS_MS,
                "delayAfterWafMs": self.DELAY_AFTER_WAF_MS,
            },
            "retry": {
                "maxRetries": self.MAX_RETRIES,
                "wafStatuses": list(self.WAF_STATUSES),
                "headers": {"accept": "application/json", "referer": "https://www.aicu.cc/", "hasUserAgent": True},
            },
            "sampleRequests": self._sample_requests(sample_uid),
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

    def _sample_requests(self, uid: str) -> dict[str, str]:
        return {
            "uid": uid,
            "commentsUrl": f"{AICU_COMMENTS_API}?uid={uid}&pn=1&ps={self.PAGE_SIZE}&mode=0&keyword=" if uid else "",
            "danmakuUrl": f"{AICU_DANMAKU_API}?uid={uid}&pn=1&ps={self.PAGE_SIZE}&keyword=" if uid else "",
        }


class AicuBatchPlanRunner:
    """Read a JS-compatible batchScrapeAicu payload and emit a dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return AicuBatchPlanner.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class AicuBatchPlanSummary:
    """Shape AICU batch dry-run plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("range", "progress", "database", "limits", "pacing", "retry", "sampleRequests")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class AicuBatchPlanContractComparator:
    """Compare AICU batch plans using the JS/Python summary contract."""

    def __init__(self, summary: AicuBatchPlanSummary | None = None):
        self.summary = summary or AicuBatchPlanSummary()

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


class AicuBatchPlanPayloadContractComparator:
    """Compare AICU batch payload plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = AicuBatchPlanSummary()
        self.comparator = AicuBatchPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = AicuBatchPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class AicuBatchPlanRequest:
    """Scraper-layer request for AICU batch plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return AicuBatchPlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return AicuBatchPlanRunner(self.payload_path).run()


class AicuBatchProgressReporter:
    """Summarize legacy AICU batch scrape progress and database payloads."""

    def __init__(
        self,
        *,
        mode: str = "uid-range",
        progress_file: str = "batch-scrape-progress.json",
        start_uid: int = 100000,
        end_uid: int = 200000,
        pages: int = 50,
    ):
        self.mode = mode
        self.progress_file = str(progress_file)
        self.start_uid = _parse_int_or(start_uid, 100000)
        self.end_uid = _parse_int_or(end_uid, 200000)
        self.pages = _parse_int_or(pages, 50)

    def build_report(self, progress: Any, database: Any) -> dict[str, Any]:
        progress_payload = progress if isinstance(progress, dict) else {}
        database_payload = database if isinstance(database, dict) else {}
        return {
            "ok": True,
            "mode": self.mode,
            "progressFile": self.progress_file,
            "progress": self._progress_summary(progress_payload),
            "database": self._database_summary(database_payload),
            "timestamps": {
                "startTime": progress_payload.get("startTime") or None,
                "endTime": progress_payload.get("endTime") or None,
                "lastUpdated": database_payload.get("lastUpdated"),
            },
        }

    def _progress_summary(self, progress: dict[str, Any]) -> dict[str, Any]:
        if self.mode == "popular":
            pages_scanned = _parse_int_or(progress.get("pagesScanned"), 0)
            return {
                "scraped": _parse_int_or(progress.get("scraped"), 0),
                "videosScanned": _parse_int_or(progress.get("videosScanned"), 0),
                "pagesScanned": pages_scanned,
                "remainingPages": max(0, self.pages - pages_scanned),
                "targetPages": self.pages,
            }

        last_uid = _parse_int_or(progress.get("lastUid"), 0)
        range_total = max(0, self.end_uid - self.start_uid + 1)
        remaining = self.end_uid - max(last_uid, self.start_uid - 1)
        errors = progress.get("errors") if isinstance(progress.get("errors"), list) else []
        return {
            "lastUid": last_uid,
            "completed": _parse_int_or(progress.get("completed"), 0),
            "errors": len(errors),
            "remaining": max(0, remaining),
            "rangeTotal": range_total,
        }

    def _database_summary(self, database: dict[str, Any]) -> dict[str, int]:
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        comments = 0
        danmaku = 0
        with_comments = 0
        for user in users.values():
            if not isinstance(user, dict):
                continue
            comment_count = self._count_comments(user)
            danmaku_count = self._count_danmaku(user)
            comments += comment_count
            danmaku += danmaku_count
            if comment_count > 0:
                with_comments += 1
        return {"users": len(users), "withComments": with_comments, "comments": comments, "danmaku": danmaku}

    def _count_comments(self, user: dict[str, Any]) -> int:
        if isinstance(user.get("comments"), list):
            return len(user["comments"])
        if isinstance(user.get("commentCount"), int):
            return user["commentCount"]
        text = user.get("commentText")
        return len([line for line in str(text).splitlines() if line.strip()]) if text else 0

    def _count_danmaku(self, user: dict[str, Any]) -> int:
        if isinstance(user.get("danmaku"), list):
            return len(user["danmaku"])
        if isinstance(user.get("danmakuCount"), int):
            return user["danmakuCount"]
        text = user.get("danmakuText")
        return len([line for line in str(text).splitlines() if line.strip()]) if text else 0


class BatchScrapeProgressRunner:
    """Summarize legacy batch scrape progress JSON without mutating scraper state."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        progress_file: str = "batch-scrape-progress.json",
        database_file: str = "aicu-user-database.json",
        mode: str = "uid-range",
        start_uid: int = 100000,
        end_uid: int = 200000,
        pages: int = 50,
    ):
        self.data_dir = Path(data_dir)
        self.progress_path = self.data_dir / progress_file
        self.database_path = self.data_dir / database_file
        self.mode = mode
        self.start_uid = _parse_int_or(start_uid, 100000)
        self.end_uid = _parse_int_or(end_uid, 200000)
        self.pages = _parse_int_or(pages, 50)

    def run(self) -> dict[str, Any]:
        progress = self._read_json(self.progress_path, {})
        database = self._read_json(self.database_path, {})
        reporter = AicuBatchProgressReporter(
            mode=self.mode,
            progress_file=self.progress_path.name,
            start_uid=self.start_uid,
            end_uid=self.end_uid,
            pages=self.pages,
        )
        return reporter.build_report(progress, database)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class AicuBatchProgressSummary:
    """Shape AICU batch progress reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "progress", "database", "timestamps")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class AicuBatchProgressContractComparator:
    """Compare AICU batch progress reports using the JS/Python summary contract."""

    def __init__(self, summary: AicuBatchProgressSummary | None = None):
        self.summary = summary or AicuBatchProgressSummary()

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


class AicuBatchProgressPayloadContractComparator:
    """Compare file-backed AICU batch progress reports against saved JS-compatible JSON."""

    def __init__(self, data_dir: str | Path, js_report_path: str | Path, **runner_options: Any):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.runner_options = runner_options
        self.summary = AicuBatchProgressSummary()
        self.comparator = AicuBatchProgressContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BatchScrapeProgressRunner(self.data_dir, **self.runner_options).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
