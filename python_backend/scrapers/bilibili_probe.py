from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlparse


DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _bounded_number(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(number, maximum))


class BilibiliProbePlanSummary:
    """Shape Bilibili probe plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "mode",
        "videos",
        "headers",
        "scannedKeys",
        "videosByTerm",
        "viewUrl",
        "replyUrl",
        "replyPageUrl",
        "replyThreadUrl",
        "searchUrls",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class BilibiliProbePlanContractComparator:
    """Compare Bilibili probe plans using the JS/Python JSON contract."""

    def __init__(self, summary: BilibiliProbePlanSummary | None = None):
        self.summary = summary or BilibiliProbePlanSummary()

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


class BilibiliProbePlanRunner:
    """Build Bilibili direct-probe URL/header plans from JSON payloads."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = BilibiliProbePlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "urls").strip().lower()
        if mode == "filter-videos":
            return {
                "ok": True,
                "mode": "filter-videos",
                "videos": self.planner.filter_unscanned_probe_videos(
                    payload.get("videos") if isinstance(payload.get("videos"), list) else [],
                    payload.get("scannedKeys") if isinstance(payload.get("scannedKeys"), list) else [],
                ),
            }
        if mode == "headers":
            return {
                "ok": True,
                "mode": "headers",
                "headers": self.planner.build_web_headers(str(payload.get("referer") or ""), payload.get("options") if isinstance(payload.get("options"), dict) else {}),
            }
        if mode == "scanned-keys":
            return {
                "ok": True,
                "mode": "scanned-keys",
                "scannedKeys": self.planner.collect_scanned_probe_video_keys(payload.get("corpus") if isinstance(payload.get("corpus"), dict) else {}),
            }
        if mode in {"source-videos", "evidence-source-videos"}:
            return {
                "ok": True,
                "mode": mode,
                "videosByTerm": self.planner.build_evidence_source_videos_for_actions(
                    payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {},
                    payload.get("actions") if isinstance(payload.get("actions"), list) else [],
                    payload.get("options") if isinstance(payload.get("options"), dict) else {},
                ),
            }

        video = payload.get("video") if isinstance(payload.get("video"), dict) else {}
        search = payload.get("search") if isinstance(payload.get("search"), dict) else {}
        return {
            "ok": True,
            "mode": "urls",
            "viewUrl": self.planner.build_view_url(video),
            "replyUrl": self.planner.build_reply_url(video),
            "replyPageUrl": self.planner.build_reply_page_url(video),
            "replyThreadUrl": self.planner.build_reply_thread_url(video),
            "searchUrls": self.planner.build_search_urls(payload.get("query") or "", search),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliProbePlanPayloadContractComparator:
    """Compare file-backed Bilibili probe plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliProbePlanSummary()
        self.comparator = BilibiliProbePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliProbePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliProbePlanRequest:
    """Scraper-layer request for Bilibili probe plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return BilibiliProbePlanPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return BilibiliProbePlanRunner(self.payload_path).run()


class BilibiliProbePlanCommandRequest:
    """Argv-backed scraper-layer request for Bilibili probe plan contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build Bilibili direct probe plans from JSON payloads.")
        parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili probe plan report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BilibiliProbePlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


class BilibiliProbePlanner:
    """Build deterministic Bilibili probe request contracts without performing network IO."""

    def build_web_headers(self, referer: str, options: dict[str, Any] | None = None) -> dict[str, str]:
        options = options or {}
        user_agent = options.get("userAgent") or DEFAULT_USER_AGENT
        origin = "https://www.bilibili.com"
        try:
            parsed = urlparse(str(referer or ""))
            if parsed.scheme and parsed.netloc:
                origin = f"{parsed.scheme}://{parsed.netloc}"
        except ValueError:
            pass

        headers = {
            "user-agent": user_agent,
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "referer": referer,
            "origin": origin,
            "sec-ch-ua": '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-mode": "cors",
            "sec-fetch-dest": "empty",
            "sec-fetch-site": "same-site",
        }
        if options.get("cookie"):
            headers["cookie"] = str(options["cookie"])
        return headers

    def build_view_url(self, video: dict[str, Any] | None = None) -> str | None:
        video = video or {}
        if video.get("bvid"):
            return f"https://api.bilibili.com/x/web-interface/view?bvid={quote_plus(_clean_text(video.get('bvid')))}"
        if video.get("aid"):
            return f"https://api.bilibili.com/x/web-interface/view?aid={quote_plus(_clean_text(video.get('aid')))}"
        return None

    def build_reply_url(self, video: dict[str, Any] | None = None, page: Any = 0, page_size: Any = 20) -> str | None:
        video = video or {}
        if not video.get("aid"):
            return None
        next_page = max(0, _bounded_number(page, 0, -10_000, 10_000))
        size = _bounded_number(page_size, 20, 1, 50)
        return f"https://api.bilibili.com/x/v2/reply/main?type=1&oid={quote_plus(_clean_text(video.get('aid')))}&mode=3&next={next_page}&ps={size}"

    def build_reply_page_url(self, video: dict[str, Any] | None = None, page: Any = 1, page_size: Any = 20) -> str | None:
        video = video or {}
        if not video.get("aid"):
            return None
        page_number = _bounded_number(page, 1, 1, 10_000)
        size = _bounded_number(page_size, 20, 1, 50)
        return f"https://api.bilibili.com/x/v2/reply?type=1&oid={quote_plus(_clean_text(video.get('aid')))}&sort=2&pn={page_number}&ps={size}"

    def build_reply_thread_url(
        self,
        video: dict[str, Any] | None = None,
        root_rpid: Any = None,
        page: Any = 1,
        page_size: Any = 20,
    ) -> str | None:
        video = video or {}
        root = root_rpid if root_rpid is not None else video.get("rootRpid")
        if not video.get("aid") or not root:
            return None
        page_number = _bounded_number(page, 1, 1, 10_000)
        size = _bounded_number(page_size, 20, 1, 50)
        return (
            "https://api.bilibili.com/x/v2/reply/reply"
            f"?type=1&oid={quote_plus(_clean_text(video.get('aid')))}&root={quote_plus(_clean_text(root))}&pn={page_number}&ps={size}"
        )

    def build_search_urls(self, query: Any, options: dict[str, Any] | None = None) -> list[str]:
        options = options or {}
        pages = _bounded_number(options.get("pages"), 1, 1, 10)
        page_size = _bounded_number(options.get("pageSize"), 20, 1, 20)
        keyword = quote_plus(_clean_text(query))
        return [
            f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={keyword}&page={index + 1}&page_size={page_size}"
            for index in range(pages)
        ]

    def filter_unscanned_probe_videos(self, videos: list[dict[str, Any]] | None = None, scanned_keys: set[str] | list[str] | None = None) -> list[dict[str, Any]]:
        scanned = set(scanned_keys or [])
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for video in videos if isinstance(videos, list) else []:
            key = self.probe_video_key(video)
            if not key or key in seen or key in scanned:
                continue
            seen.add(key)
            result.append(video)
        return result

    def probe_video_key(self, video: dict[str, Any] | None = None) -> str:
        video = video or {}
        if video.get("bvid"):
            bvid = _clean_text(video.get("bvid")).rstrip("/")
            return f"bvid:{bvid}" if bvid else ""
        if video.get("aid"):
            aid = re.sub(r"^av", "", _clean_text(video.get("aid")).rstrip("/"), flags=re.I)
            return f"aid:{aid}" if aid else ""
        return ""

    def extract_video_refs(self, text: Any = "") -> list[dict[str, str]]:
        refs: list[dict[str, str]] = []
        seen: set[str] = set()
        source = str(text or "")
        pattern = re.compile(r"(?:https?://)?(?:www\.)?bilibili\.com/video/((?:BV[0-9A-Za-z]+)|(?:av\d+))")
        for match in pattern.finditer(source):
            video_id = match.group(1)
            ref = {"bvid": video_id} if video_id.startswith("BV") else {"aid": video_id[2:]}
            tail = source[match.start() : match.end() + 200]
            reply_match = re.search(r"[?&]reply=(\d+)", tail)
            if reply_match:
                ref["rootRpid"] = reply_match.group(1)
            key = f"bvid:{ref['bvid']}" if "bvid" in ref else f"aid:{ref['aid']}"
            if key in seen:
                continue
            seen.add(key)
            refs.append(ref)
        return refs

    def collect_scanned_probe_video_keys(self, corpus: dict[str, Any] | None = None) -> list[str]:
        corpus = corpus or {}
        keys: set[str] = set()
        for run in corpus.get("runs") if isinstance(corpus.get("runs"), list) else []:
            for video in run.get("videos") if isinstance(run, dict) and isinstance(run.get("videos"), list) else []:
                if not isinstance(video, dict):
                    continue
                key = _clean_text(video.get("key")) or self.probe_video_key(video)
                if key:
                    keys.add(key)
        for comment in corpus.get("comments") if isinstance(corpus.get("comments"), list) else []:
            if not isinstance(comment, dict):
                continue
            for ref in self.extract_video_refs(comment.get("source")):
                key = self.probe_video_key(ref)
                if key:
                    keys.add(key)
        return sorted(keys)

    def build_evidence_source_videos_for_actions(
        self,
        dictionary: dict[str, Any] | None = None,
        actions: list[dict[str, Any]] | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, list[dict[str, str]]]:
        dictionary = dictionary or {}
        options = options or {}
        max_per_action = max(0, min(_bounded_number(options.get("maxPerAction"), 0, 0, 50), 50))
        if not max_per_action:
            return {}

        entries: dict[str, dict[str, Any]] = {}
        raw_entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        for entry in raw_entries:
            if isinstance(entry, dict) and _clean_text(entry.get("term")):
                entries[_clean_text(entry.get("term"))] = entry
        corpus_sources_by_message: dict[str, str] = {}
        corpus = options.get("corpus") if isinstance(options.get("corpus"), dict) else {}
        for comment in corpus.get("comments") if isinstance(corpus.get("comments"), list) else []:
            if not isinstance(comment, dict):
                continue
            message = _clean_text(comment.get("message"))
            if not message:
                continue
            source = _clean_text(comment.get("source"))
            existing = corpus_sources_by_message.get(message)
            if not existing or self._source_recovery_priority(source) < self._source_recovery_priority(existing):
                corpus_sources_by_message[message] = source

        result: dict[str, list[dict[str, str]]] = {}
        for action in actions if isinstance(actions, list) else []:
            if not isinstance(action, dict):
                continue
            term = _clean_text(action.get("term"))
            entry = entries.get(term)
            if not term or not entry:
                continue
            candidate_sources: list[str] = []
            raw_sources = entry.get("evidenceSources") if isinstance(entry.get("evidenceSources"), list) else []
            for source in raw_sources:
                if isinstance(source, dict):
                    candidate_sources.append(_clean_text(source.get("source")))
            if isinstance(entry.get("evidenceSamples"), list):
                candidate_sources.extend(corpus_sources_by_message.get(_clean_text(sample), "") for sample in entry.get("evidenceSamples"))
            videos: list[dict[str, str]] = []
            seen: set[str] = set()
            for source in sorted(candidate_sources, key=self._source_recovery_priority):
                for ref in self.extract_video_refs(source):
                    key = self.probe_video_key(ref)
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    video = dict(ref)
                    video["title"] = f"existing evidence source for {term}"
                    videos.append(video)
                    if len(videos) >= max_per_action:
                        break
                if len(videos) >= max_per_action:
                    break
            if videos:
                result[term] = videos
        return result

    def _source_recovery_priority(self, source: Any = "") -> int:
        text = _clean_text(source)
        if re.search(r"[?&]reply=\d+", text):
            return 0
        if "comment probe" in text or "reply detail probe" in text:
            return 1
        if "danmaku" in text:
            return 3
        return 2
