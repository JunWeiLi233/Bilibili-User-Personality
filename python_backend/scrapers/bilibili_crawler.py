from __future__ import annotations

import html
import json
import math
import re
from pathlib import Path
from typing import Any

from python_backend.scrapers.rate_limiter import RateLimitPolicy


BLOCK_CODES = {-101, -111, -352, -412, -509, -799}


def _bounded_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        number = fallback
    if not math.isfinite(number):
        number = fallback
    bounded = max(minimum, min(number, maximum))
    return int(bounded) if float(bounded).is_integer() else bounded


class BilibiliCrawlerConfigBuilder:
    """Build JS-compatible Bilibili crawler runtime config from environment payloads."""

    def build(self, env: dict[str, Any] | None = None) -> dict[str, int | float]:
        env = env if isinstance(env, dict) else {}
        pacing = RateLimitPolicy(
            min_delay_ms=env.get("BILIBILI_CRAWLER_MIN_DELAY_MS", 2500),
            jitter_ms=env.get("BILIBILI_CRAWLER_JITTER_MS", 2000),
            block_cooldown_ms=env.get("BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS", 120000),
        ).to_bilibili_crawler_options()
        return {
            **pacing,
            "cacheTtlMs": _bounded_number(env.get("BILIBILI_CRAWLER_CACHE_TTL_MS", 300000), 300000, 0, 300000),
            "longPauseProbability": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_PROBABILITY", 0.15), 0.15, 0, 1),
            "longPauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_MIN_MS", 3000), 3000, 0, 60000),
            "longPauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_MAX_MS", 8000), 8000, 0, 60000),
            "pagePauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_PAGE_PAUSE_MIN_MS", 1500), 1500, 0, 60000),
            "pagePauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_PAGE_PAUSE_MAX_MS", 3000), 3000, 0, 60000),
            "objectPauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_OBJECT_PAUSE_MIN_MS", 2000), 2000, 0, 60000),
            "objectPauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_OBJECT_PAUSE_MAX_MS", 5000), 5000, 0, 60000),
            "requestTimeoutMs": _bounded_number(env.get("BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS", 30000), 30000, 0, 120000),
        }


class BilibiliCrawlerSummary:
    """Shape Bilibili crawler helper output into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "bvids",
        "bvid",
        "blocked",
        "cookie",
        "objects",
        "targetReplies",
        "danmaku",
        "dynamicRecords",
        "crawlerConfig",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class BilibiliCrawlerContractComparator:
    """Compare Bilibili crawler helper outputs using the JS/Python summary contract."""

    def __init__(self, summary: BilibiliCrawlerSummary | None = None):
        self.summary = summary or BilibiliCrawlerSummary()

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


class BilibiliCrawlerRunner:
    """Run deterministic Bilibili crawler helper functions from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.helper = BilibiliCrawlerHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.helper.run_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliCrawlerPayloadContractComparator:
    """Compare file-backed Python crawler helper output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliCrawlerSummary()
        self.comparator = BilibiliCrawlerContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliCrawlerRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliCrawlerHelper:
    """Normalize Bilibili crawler identifiers and block responses without network IO."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        text = payload.get("text") or payload.get("input") or ""
        block_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        result = {
            "ok": True,
            "bvids": self.parse_bvid_pool(text),
            "bvid": self.extract_bvid(text),
            "blocked": self.is_block_response(block_payload),
        }
        if "cookie" in payload:
            result["cookie"] = self.normalize_bilibili_cookie(payload.get("cookie"))
        if isinstance(payload.get("objects"), list):
            result["objects"] = self.dedupe_public_objects(payload.get("objects"))
        if isinstance(payload.get("reply"), dict):
            result["targetReplies"] = self.collect_reply_for_uid(
                payload.get("reply"),
                payload.get("targetUid"),
                payload.get("object") if isinstance(payload.get("object"), dict) else {},
                [],
            )
        if "danmakuXml" in payload:
            result["danmaku"] = self.parse_danmaku_xml(
                payload.get("danmakuXml"),
                payload.get("video") if isinstance(payload.get("video"), dict) else {},
            )
        if isinstance(payload.get("dynamicItems"), list):
            result["dynamicRecords"] = self.extract_dynamic_records(payload.get("dynamicItems"), payload.get("uid"))
        if isinstance(payload.get("env"), dict):
            result["crawlerConfig"] = self.build_crawler_config(payload.get("env"))
        return result

    def build_crawler_config(self, env: dict[str, Any] | None = None) -> dict[str, int | float]:
        return BilibiliCrawlerConfigBuilder().build(env)

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

    def extract_dynamic_records(self, items: list[dict[str, Any]] | None = None, uid: Any = "") -> dict[str, list[dict[str, Any]]]:
        objects: list[dict[str, Any]] = []
        authored_posts: list[dict[str, Any]] = []
        uid_text = str(uid or "")

        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            dynamic_id = str(item.get("id_str") or item.get("id") or "")
            basic = item.get("basic") if isinstance(item.get("basic"), dict) else {}
            comment_type = self._number(basic.get("comment_type"), 0)
            comment_oid = str(basic.get("comment_id_str") or basic.get("comment_id") or "")
            text = self._dynamic_text(item)
            title = self._dynamic_title(item, text)
            source_url = f"https://t.bilibili.com/{dynamic_id}" if dynamic_id else f"https://space.bilibili.com/{uid_text}/dynamic"

            if text:
                authored_posts.append(
                    {
                        "sourceKind": "dynamic-post",
                        "oid": comment_oid or dynamic_id,
                        "replyType": comment_type or 17,
                        "sourceTitle": title,
                        "sourceUrl": source_url,
                        "rpid": f"dynamic-{dynamic_id or comment_oid}",
                        "like": 0,
                        "ctime": self._number(self._path(item, "modules", "module_author", "pub_ts"), 0),
                        "uname": self._path(item, "modules", "module_author", "name") or "",
                        "mid": uid_text,
                        "message": text,
                    }
                )

            if comment_type > 0 and comment_oid:
                objects.append(
                    {
                        "id": f"dynamic-{comment_type}-{comment_oid}",
                        "kind": "dynamic",
                        "oid": comment_oid,
                        "replyType": comment_type,
                        "title": f"\u52a8\u6001\uff1a{self._text_snippet(title, comment_oid)}",
                        "authorMid": uid_text,
                        "sourceUrl": source_url,
                        "replyCount": self._number(self._path(item, "modules", "module_stat", "comment", "count"), 0),
                    }
                )

        return {"objects": objects, "authoredPosts": authored_posts}

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

    def _dynamic_text(self, item: dict[str, Any]) -> str:
        dynamic = self._path(item, "modules", "module_dynamic")
        dynamic = dynamic if isinstance(dynamic, dict) else {}
        major = dynamic.get("major") if isinstance(dynamic.get("major"), dict) else {}
        opus = major.get("opus") if isinstance(major.get("opus"), dict) else {}
        archive = major.get("archive") if isinstance(major.get("archive"), dict) else {}
        article = major.get("article") if isinstance(major.get("article"), dict) else {}
        values = [
            self._path(dynamic, "desc", "text"),
            self._path(opus, "summary", "text"),
            opus.get("title"),
            archive.get("desc"),
            archive.get("title"),
            article.get("desc"),
            article.get("title"),
        ]
        return str(next((value for value in values if value), "")).strip()

    def _dynamic_title(self, item: dict[str, Any], text: str) -> str:
        dynamic = self._path(item, "modules", "module_dynamic")
        dynamic = dynamic if isinstance(dynamic, dict) else {}
        major = dynamic.get("major") if isinstance(dynamic.get("major"), dict) else {}
        archive = major.get("archive") if isinstance(major.get("archive"), dict) else {}
        article = major.get("article") if isinstance(major.get("article"), dict) else {}
        opus = major.get("opus") if isinstance(major.get("opus"), dict) else {}
        title = archive.get("title") or article.get("title") or opus.get("title")
        return str(title or self._text_snippet(text, f"\u52a8\u6001 {item.get('id_str') or item.get('id') or ''}"))

    def _text_snippet(self, text: Any, fallback: Any) -> str:
        clean = re.sub(r"\s+", " ", str(text or "")).strip()
        if not clean:
            return str(fallback)
        return f"{clean[:48]}..." if len(clean) > 48 else clean

    def _path(self, value: Any, *keys: str) -> Any:
        current = value
        for key in keys:
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current

    def _number(self, value: Any, fallback: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return fallback
