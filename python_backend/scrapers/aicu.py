from __future__ import annotations

import re
from pathlib import Path
from typing import Any


AICU_COMMENTS_API = "https://api.aicu.cc/api/v3/search/getreply"
AICU_DANMAKU_API = "https://api.aicu.cc/api/v3/search/getvideodm"


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
