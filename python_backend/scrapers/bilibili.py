from __future__ import annotations

import html
import re
from typing import Any


class BilibiliPublicParser:
    """Parse public Bilibili identifiers and danmaku into the JS comment contract."""

    def parse_bvid_pool(self, raw: Any) -> list[str]:
        values = re.split(r"[\s,\uFF0C]+", str(raw or ""))
        return [value.strip() for value in values if re.match(r"^BV[0-9A-Za-z]+$", value.strip())]

    def extract_bvid(self, value: Any) -> str:
        match = re.search(r"BV[0-9A-Za-z]+", str(value or "").strip())
        return match.group(0) if match else ""

    def parse_danmaku_xml(self, xml: Any, video: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        video = video or {}
        items: list[dict[str, Any]] = []
        pattern = re.compile(r'<d\b[^>]*p="([^"]*)"[^>]*>([\s\S]*?)</d>', flags=re.IGNORECASE)
        index = 0
        for match in pattern.finditer(str(xml or "")):
            message = re.sub(r"\s+", " ", html.unescape(match.group(2) or "")).strip()
            if not message:
                continue
            meta = str(match.group(1) or "").split(",")
            items.append(
                {
                    "bvid": video.get("bvid"),
                    "oid": str(video.get("oid") or ""),
                    "replyType": int(video.get("replyType") or 1),
                    "sourceTitle": video.get("title") or "",
                    "sourceUrl": video.get("sourceUrl") or "",
                    "rpid": f"danmaku-{video.get('cid') or video.get('oid') or video.get('bvid')}-{index}",
                    "like": 0,
                    "ctime": int(float(meta[4] if len(meta) > 4 and meta[4] else 0)),
                    "uname": "",
                    "mid": str(meta[6] if len(meta) > 6 else ""),
                    "message": message,
                    "kind": "danmaku",
                }
            )
            index += 1
        return items
