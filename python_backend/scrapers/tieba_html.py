from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse, urlunparse


TIEBA_BASE = "https://tieba.baidu.com"


def _decode_html(value: Any) -> str:
    return html.unescape(str(value or "")).replace("&nbsp;", " ")


def _clean_text(value: Any) -> str:
    text = _decode_html(value)
    text = re.sub(r"<script\b[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<style\b[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_first(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1) if match else ""


def _absolute_thread_url(thread_id: str) -> str:
    return f"{TIEBA_BASE}/p/{quote(str(thread_id))}"


def _mobile_thread_fetch_url(value: Any, thread_id: str) -> str:
    text = str(value or "").strip()
    if not text or "c.tieba.baidu.com/p/" not in text.lower():
        return ""
    try:
        parsed = urlparse(text)
    except ValueError:
        return ""
    if parsed.hostname != "c.tieba.baidu.com":
        return ""
    query = parsed.query
    if "mo_device=" not in query:
        query = f"{query}&mo_device=1" if query else "mo_device=1"
    return urlunparse((parsed.scheme or "https", parsed.netloc, f"/p/{quote(str(thread_id))}", "", query, ""))


def _parse_data_field(value: str) -> dict[str, Any]:
    decoded = _decode_html(value)
    for candidate in (decoded, decoded.replace(r"\"", '"')):
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        return payload if isinstance(payload, dict) else {}
    return {}


def _extract_data_field(block: str) -> str:
    return _extract_first(r"\bdata-field='([^']*)'", block) or _extract_first(r'\bdata-field="([^"]*)"', block)


class TiebaHtmlParseSummary:
    """Shape Tieba HTML parser output into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "threads", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class TiebaHtmlParseContractComparator:
    """Compare Tieba HTML parser payloads with the shared JS/Python contract."""

    def __init__(self, summary: TiebaHtmlParseSummary | None = None):
        self.summary = summary or TiebaHtmlParseSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class TiebaHtmlParseRunner:
    """Parse stored Tieba HTML payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = TiebaHtmlParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.parser.parse_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaHtmlParsePayloadContractComparator:
    """Compare file-backed Tieba HTML parse output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.comparator = TiebaHtmlParseContractComparator(TiebaHtmlParseSummary())

    def compare(self) -> dict[str, Any]:
        python_result = TiebaHtmlParseRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaHtmlParseRequest:
    """Scraper-layer request for Tieba HTML parser JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return TiebaHtmlParsePayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return TiebaHtmlParseRunner(self.payload_path).run()


class TiebaHtmlParser:
    """Parse saved Tieba HTML into the JS scraper JSON contract."""

    def parse_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        mode = str(payload.get("mode") or "threads").strip().lower()
        html_text = payload.get("html") or ""
        keyword = str(payload.get("keyword") or "")

        if mode == "comments":
            comments = self.parse_thread_comments(html_text, payload.get("thread") if isinstance(payload.get("thread"), dict) else {})
            return {"ok": True, "mode": "comments", "comments": comments}
        if mode == "discovery-comments":
            threads = payload.get("threads")
            if not isinstance(threads, list):
                threads = self.parse_threads(html_text, keyword)
            comments = self.threads_to_discovery_comments(threads, keyword)
            return {"ok": True, "mode": "discovery-comments", "threads": threads, "comments": comments}

        threads = self.parse_threads(html_text, keyword)
        return {"ok": True, "mode": "threads", "threads": threads}

    def thread_from_url(self, value: Any, keyword: str = "") -> dict[str, Any] | None:
        text = str(value or "").strip()
        if not text:
            return None
        match = re.search(r"(?:^|/p/)(\d{4,})(?:\D|$)", text)
        if not match:
            return None
        thread_id = match.group(1)
        thread: dict[str, Any] = {
            "id": thread_id,
            "kind": "tieba-thread",
            "title": f"Tieba thread {thread_id}",
            "keyword": str(keyword or ""),
            "sourceUrl": _absolute_thread_url(thread_id),
        }
        fetch_url = _mobile_thread_fetch_url(text, thread_id)
        if fetch_url:
            thread["fetchUrl"] = fetch_url
        return thread

    def parse_threads(self, html_text: Any, keyword: str = "") -> list[dict[str, Any]]:
        text = str(html_text or "")
        threads: list[dict[str, Any]] = []
        seen: set[str] = set()
        pattern = re.compile(
            r"<a\b[^>]*href=[\"'](?:https?://tieba\.baidu\.com)?/p/(\d+)[^\"']*[\"'][^>]*>([\s\S]*?)</a>",
            flags=re.IGNORECASE,
        )
        for match in pattern.finditer(text):
            thread_id = str(match.group(1) or "").strip()
            if not thread_id or thread_id in seen:
                continue
            seen.add(thread_id)
            tag = match.group(0)
            title_attr = _extract_first(r'\btitle=["\']([^"\']+)["\']', tag)
            title = _clean_text(title_attr or match.group(2) or f"Tieba thread {thread_id}")[:160]
            threads.append(
                {
                    "id": thread_id,
                    "kind": "tieba-thread",
                    "title": title,
                    "keyword": str(keyword or ""),
                    "sourceUrl": _absolute_thread_url(thread_id),
                }
            )
        return threads

    def parse_thread_comments(self, html_text: Any, thread: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        thread = thread or {}
        comments: list[dict[str, Any]] = []
        seen: set[str] = set()
        for index, block in enumerate(self._post_blocks(str(html_text or ""))):
            data_field_raw = _extract_data_field(block)
            data_field = _parse_data_field(data_field_raw) if data_field_raw else {}
            post_id = self._post_id(block, data_field, index)
            message = self._post_message(block)
            if not message:
                continue
            rpid = f"tieba-{thread.get('id') or 'unknown'}-{post_id}"
            if rpid in seen:
                continue
            seen.add(rpid)
            comments.append(
                {
                    "sourceKind": "tieba-thread",
                    "sourceTitle": thread.get("title") or "",
                    "sourceUrl": thread.get("sourceUrl") or (_absolute_thread_url(str(thread.get("id"))) if thread.get("id") else TIEBA_BASE),
                    "rpid": rpid,
                    "like": 0,
                    "ctime": 0,
                    "uname": self._post_author(block, data_field),
                    "mid": "",
                    "message": message,
                    "platform": "tieba",
                }
            )
        return comments

    def threads_to_discovery_comments(self, threads: list[dict[str, Any]] | None = None, keyword: str = "") -> list[dict[str, Any]]:
        comments: list[dict[str, Any]] = []
        seen: set[str] = set()
        for thread in threads if isinstance(threads, list) else []:
            title = _clean_text(thread.get("title") if isinstance(thread, dict) else "")
            if not title or re.match(r"^Tieba thread \d+$", title, flags=re.IGNORECASE):
                continue
            thread_id = str(thread.get("id") or "").strip()
            key = f"{thread_id}\n{title}"
            if key in seen:
                continue
            seen.add(key)
            comments.append(
                {
                    "sourceKind": "tieba-discovery",
                    "sourceTitle": title,
                    "sourceUrl": thread.get("sourceUrl") or (_absolute_thread_url(thread_id) if thread_id else TIEBA_BASE),
                    "rpid": f"tieba-discovery-{thread_id or len(comments) + 1}",
                    "like": 0,
                    "ctime": 0,
                    "uname": "",
                    "mid": "",
                    "message": title,
                    "platform": "tieba",
                    "keyword": str(keyword or thread.get("keyword") or ""),
                }
            )
        return comments

    def _post_blocks(self, html_text: str) -> list[str]:
        pattern = re.compile(
            r"<div\b[^>]*class=[\"'][^\"']*\bl_post\b[^\"']*[\"'][^>]*[\s\S]*?(?=<div\b[^>]*class=[\"'][^\"']*\bl_post\b|$)",
            flags=re.IGNORECASE,
        )
        return [match.group(0) for match in pattern.finditer(html_text)]

    def _post_id(self, block: str, data_field: dict[str, Any], index: int) -> str:
        content = data_field.get("content") if isinstance(data_field.get("content"), dict) else {}
        value = content.get("post_id") or content.get("post_no") or data_field.get("post_id") or _extract_first(r"\bdata-pid=[\"']?(\d+)", block)
        return str(value or index + 1)

    def _post_author(self, block: str, data_field: dict[str, Any]) -> str:
        author = data_field.get("author") if isinstance(data_field.get("author"), dict) else {}
        value = author.get("user_name") or author.get("name") or author.get("user_nickname") or _extract_first(r'\busername=["\']([^"\']+)["\']', block)
        return str(value or "").strip()

    def _post_message(self, block: str) -> str:
        explicit = _extract_first(r"<div\b[^>]*class=[\"'][^\"']*\bd_post_content\b[^\"']*[\"'][^>]*>([\s\S]*?)</div>", block)
        explicit = explicit or _extract_first(r"<cc\b[^>]*>([\s\S]*?)</cc>", block)
        return _clean_text(explicit or block)
