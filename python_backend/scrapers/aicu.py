from __future__ import annotations

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


class AicuScrapePlanner:
    """Build a read-only plan compatible with scrapeAicuUsers.js UID inputs."""

    def __init__(self, *, max_pages: int = 10, page_size: int = 20, delay_between_uids_ms: int = 15000):
        self.max_pages = int(max_pages)
        self.page_size = int(page_size)
        self.delay_between_uids_ms = int(delay_between_uids_ms)

    def build_plan(self, argv: list[str], *, max_pages: int | None = None) -> dict[str, Any]:
        pages = int(max_pages if max_pages is not None else self.max_pages)
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
