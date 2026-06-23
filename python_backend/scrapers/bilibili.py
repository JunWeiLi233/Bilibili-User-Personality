from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import safe_read_json_object


class BilibiliParseSummary:
    """Shape Bilibili parser output into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "bvids", "bvid", "view", "searchVideos", "popularVideos", "spaceVideos", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class BilibiliParseContractComparator:
    """Compare Bilibili parser outputs using the JS/Python summary contract."""

    def __init__(self, summary: BilibiliParseSummary | None = None):
        self.summary = summary or BilibiliParseSummary()

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


class BilibiliParseRunner:
    """Parse stored Bilibili payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = BilibiliPublicParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.parser.parse_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliParsePayloadContractComparator:
    """Compare file-backed Python Bilibili parser output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliParseSummary()
        self.comparator = BilibiliParseContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliParseRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class BilibiliParseRequest:
    """Scraper-layer request for Bilibili parser JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return BilibiliParsePayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return BilibiliParseRunner(self.payload_path).run()


class BilibiliParseCommandRequest:
    """Argv-backed scraper-layer request for Bilibili parser contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Parse Bilibili public payloads into Python backend JSON contracts.")
        parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili parser report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BilibiliParseRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


class BilibiliPublicParser:
    """Parse public Bilibili identifiers and danmaku into the JS comment contract."""

    def parse_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        mode = str(payload.get("mode") or "danmaku").strip().lower()
        if mode == "bvid-pool":
            return {"ok": True, "mode": "bvid-pool", "bvids": self.parse_bvid_pool(payload.get("raw"))}
        if mode == "extract-bvid":
            return {"ok": True, "mode": "extract-bvid", "bvid": self.extract_bvid(payload.get("input"))}
        if mode == "video-objects":
            return {
                "ok": True,
                "mode": "video-objects",
                "view": self.video_object_from_view(payload.get("bvid"), payload.get("view") if isinstance(payload.get("view"), dict) else {}),
                "searchVideos": [
                    self.video_object_from_search_item(item)
                    for item in (payload.get("searchItems") if isinstance(payload.get("searchItems"), list) else [])
                    if isinstance(item, dict)
                ],
                "popularVideos": [
                    self.video_object_from_popular_item(item)
                    for item in (payload.get("popularItems") if isinstance(payload.get("popularItems"), list) else [])
                    if isinstance(item, dict)
                ],
                "spaceVideos": [
                    self.video_object_from_space_item(item, payload.get("uid"))
                    for item in (payload.get("spaceItems") if isinstance(payload.get("spaceItems"), list) else [])
                    if isinstance(item, dict)
                ],
            }

        video = payload.get("video") if isinstance(payload.get("video"), dict) else {}
        return {"ok": True, "mode": "danmaku", "comments": self.parse_danmaku_xml(payload.get("xml") or "", video)}

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
