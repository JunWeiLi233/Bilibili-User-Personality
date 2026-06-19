from __future__ import annotations

import re
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
            return f"bvid:{_clean_text(video.get('bvid'))}"
        if video.get("aid"):
            return f"aid:{_clean_text(video.get('aid'))}"
        if video.get("key"):
            return _clean_text(video.get("key"))
        return ""
