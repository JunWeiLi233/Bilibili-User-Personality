from __future__ import annotations

import re
from typing import Any


BLOCK_CODES = {-101, -111, -352, -412, -509, -799}


class BilibiliCrawlerHelper:
    """Normalize Bilibili crawler identifiers and block responses without network IO."""

    def parse_bvid_pool(self, raw: Any = "") -> list[str]:
        text = str(raw or "")
        return [
            item.strip()
            for item in re.split(r"[\s,，、;|锛]+", text)
            if re.fullmatch(r"BV[0-9A-Za-z]+", item.strip())
        ]

    def extract_bvid(self, value: Any = "") -> str:
        match = re.search(r"BV[0-9A-Za-z]+", str(value or "").strip())
        return match.group(0) if match else ""

    def is_block_response(self, payload: dict[str, Any] | None = None) -> bool:
        payload = payload or {}
        try:
            code = int(float(payload.get("code")))
        except (TypeError, ValueError):
            return False
        return code in BLOCK_CODES
