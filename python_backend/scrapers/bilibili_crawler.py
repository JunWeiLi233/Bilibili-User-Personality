from __future__ import annotations

import html
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

    def normalize_bilibili_cookie(self, value: Any = "") -> str:
        parts = []
        for part in re.split(r";\s*", str(value or "")):
            part = part.strip()
            eq = part.find("=")
            if eq <= 0:
                continue
            name = part[:eq].strip()
            cookie_value = part[eq + 1 :].strip()
            if not name or not cookie_value:
                continue
            if re.search(r"[\r\n:]", name) or re.search(r"[\r\n]", cookie_value):
                continue
            parts.append(f"{name}={cookie_value}")
        return "; ".join(parts)

    def collect_reply_for_uid(
        self,
        reply: dict[str, Any] | None,
        target_uid: Any,
        obj: dict[str, Any] | None,
        bucket: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        bucket = bucket if bucket is not None else []
        if not isinstance(reply, dict) or not isinstance(reply.get("content"), dict) or not isinstance(reply.get("member"), dict):
            return bucket
        obj = obj if isinstance(obj, dict) else {}
        member = reply.get("member") or {}
        mid = str(reply.get("mid") or member.get("mid") or "")
        if mid == str(target_uid):
            bucket.append(self._reply_record(reply, obj, mid))
        for child in reply.get("replies") if isinstance(reply.get("replies"), list) else []:
            self.collect_reply_for_uid(child, target_uid, obj, bucket)
        return bucket

    def dedupe_public_objects(self, objects: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for obj in objects if isinstance(objects, list) else []:
            if not isinstance(obj, dict) or not obj.get("oid"):
                continue
            reply_type = self._number(obj.get("replyType"), 1)
            oid = str(obj.get("oid") or "")
            key = f"{reply_type}:{oid}"
            if key in seen:
                continue
            seen.add(key)
            unique.append({**obj, "oid": oid, "replyType": reply_type})
        return unique

    def parse_danmaku_xml(self, xml: Any = "", video: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        video = video if isinstance(video, dict) else {}
        items: list[dict[str, Any]] = []
        text = str(xml or "")
        pattern = re.compile(r'<d\b[^>]*p="([^"]*)"[^>]*>([\s\S]*?)</d>', re.IGNORECASE)
        index = 0
        for match in pattern.finditer(text):
            message = re.sub(r"\s+", " ", html.unescape(match.group(2))).strip()
            if not message:
                continue
            meta = str(match.group(1) or "").split(",")
            items.append(
                {
                    "bvid": video.get("bvid"),
                    "oid": str(video.get("oid") or ""),
                    "replyType": self._number(video.get("replyType"), 1),
                    "sourceTitle": video.get("title") or "",
                    "sourceUrl": video.get("sourceUrl") or "",
                    "rpid": f"danmaku-{video.get('cid') or video.get('oid') or video.get('bvid')}-{index}",
                    "like": 0,
                    "ctime": self._number(meta[4] if len(meta) > 4 else 0, 0),
                    "uname": "",
                    "mid": str(meta[6] if len(meta) > 6 else ""),
                    "message": message,
                    "kind": "danmaku",
                }
            )
            index += 1
        return items

    def _reply_record(self, reply: dict[str, Any], obj: dict[str, Any], mid: str) -> dict[str, Any]:
        member = reply.get("member") or {}
        content = reply.get("content") or {}
        return {
            "sourceKind": obj.get("kind"),
            "bvid": obj.get("bvid"),
            "oid": str(obj.get("oid") or ""),
            "replyType": self._number(obj.get("replyType"), 1),
            "sourceTitle": obj.get("title") or "",
            "sourceUrl": obj.get("sourceUrl") or "",
            "rpid": str(reply.get("rpid") or ""),
            "like": self._number(reply.get("like"), 0),
            "ctime": self._number(reply.get("ctime"), 0),
            "uname": member.get("uname") or "",
            "mid": mid,
            "message": content.get("message") or "",
        }

    def _number(self, value: Any, fallback: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return fallback
