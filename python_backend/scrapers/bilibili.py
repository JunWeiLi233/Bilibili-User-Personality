from __future__ import annotations

import html
import re
from typing import Any


class BilibiliParseSummary:
    """Shape Bilibili parser output into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "bvids", "bvid", "view", "searchVideos", "popularVideos", "spaceVideos", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class BilibiliPublicParser:
    """Parse public Bilibili identifiers and danmaku into the JS comment contract."""

    def parse_bvid_pool(self, raw: Any) -> list[str]:
        values = re.split(r"[\s,\uFF0C]+", str(raw or ""))
        return [value.strip() for value in values if re.match(r"^BV[0-9A-Za-z]+$", value.strip())]

    def extract_bvid(self, value: Any) -> str:
        match = re.search(r"BV[0-9A-Za-z]+", str(value or "").strip())
        return match.group(0) if match else ""

    def video_object_from_view(self, bvid: Any, data: dict[str, Any] | None = None) -> dict[str, Any]:
        data = data if isinstance(data, dict) else {}
        bvid_text = str(bvid or "")
        return {
            "id": f"video-1-{data.get('aid')}",
            "kind": "video",
            "bvid": bvid_text,
            "oid": str(data.get("aid")),
            "replyType": 1,
            "title": data.get("title") or bvid_text,
            "authorMid": str(self._path(data, "owner", "mid") or ""),
            "sourceUrl": f"https://www.bilibili.com/video/{bvid_text}/",
            "replyCount": self._number(self._path(data, "stat", "reply"), 0),
            "cid": str(data.get("cid") or self._path(data, "pages", 0, "cid") or ""),
        }

    def video_object_from_space_item(self, item: dict[str, Any] | None = None, uid: Any = "") -> dict[str, Any]:
        item = item if isinstance(item, dict) else {}
        bvid = item.get("bvid")
        return {
            "id": f"video-1-{item.get('aid')}",
            "kind": "video",
            "bvid": bvid,
            "oid": str(item.get("aid")),
            "replyType": 1,
            "title": item.get("title") or bvid,
            "authorMid": str(item.get("mid") or uid or ""),
            "sourceUrl": f"https://www.bilibili.com/video/{bvid}/",
            "replyCount": self._number(item.get("comment"), 0),
        }

    def video_object_from_search_item(self, item: dict[str, Any] | None = None) -> dict[str, Any]:
        item = item if isinstance(item, dict) else {}
        bvid = item.get("bvid")
        video_id = item.get("aid") or item.get("id") or bvid
        return {
            "id": f"video-1-{video_id}",
            "kind": "video",
            "bvid": bvid,
            "oid": str(item.get("aid") or item.get("id") or ""),
            "replyType": 1,
            "title": self.clean_search_title(item.get("title"), bvid),
            "authorMid": str(item.get("mid") or item.get("author_mid") or ""),
            "sourceUrl": item.get("arcurl") or f"https://www.bilibili.com/video/{bvid}/",
            "replyCount": self._number(item.get("review") or item.get("comment"), 0),
        }

    def video_object_from_popular_item(self, item: dict[str, Any] | None = None) -> dict[str, Any]:
        item = item if isinstance(item, dict) else {}
        bvid = item.get("bvid")
        video_id = item.get("aid") or bvid
        reply_count = self._path(item, "stat", "reply")
        if reply_count is None:
            reply_count = self._path(item, "stat", "danmaku")
        return {
            "id": f"video-1-{video_id}",
            "kind": "video",
            "bvid": bvid,
            "oid": str(item.get("aid") or ""),
            "replyType": 1,
            "title": item.get("title") or bvid,
            "authorMid": str(self._path(item, "owner", "mid") or item.get("mid") or ""),
            "sourceUrl": item.get("short_link_v2") or f"https://www.bilibili.com/video/{bvid}/",
            "replyCount": self._number(reply_count, 0),
        }

    def clean_search_title(self, title: Any, fallback: Any = "") -> str:
        clean = re.sub(r"<[^>]+>", "", str(title or ""))
        clean = (
            clean.replace("&quot;", '"')
            .replace("&amp;", "&")
            .replace("&#39;", "'")
        )
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean or str(fallback or "")

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

    def _number(self, value: Any, fallback: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return fallback

    def _path(self, value: Any, *keys: Any) -> Any:
        current = value
        for key in keys:
            if isinstance(key, int):
                if not isinstance(current, list) or key >= len(current):
                    return None
                current = current[key]
                continue
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current
