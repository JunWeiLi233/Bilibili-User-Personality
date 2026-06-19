from __future__ import annotations

import html
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote


DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = "server/data/bilibiliHistoryTagCorpus.json"
DEFAULT_HISTORY_TAG_SEEDS = [
    "鍘嗗彶",
    "涓浗鍘嗗彶",
    "涓栫晫鍘嗗彶",
    "杩戜唬鍙?",
    "鍙や唬鍙?",
    "鍘嗗彶绉戞櫘",
    "鍘嗗彶瑙ｈ",
    "鍘嗗彶浜虹墿",
    "鍘嗗彶浜嬩欢",
    "鎴樹簤鍙?",
    "鍐涗簨鍘嗗彶",
    "鑰冨彜",
    "鏂囩墿",
    "鍗氱墿棣?",
    "鏄庢湞",
    "娓呮湞",
    "涓夊浗",
    "绉︽眽",
    "鍞愭湞",
    "瀹嬫湞",
    "姘戝浗",
]


def _parse_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item or "").strip() for item in value if str(item or "").strip()]
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _clean_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE)
    return text.lower()


def _clean_title(value: Any, fallback: str = "") -> str:
    text = str(value or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or fallback


def _unique_by(items: list[Any], key_fn) -> list[Any]:
    seen = set()
    result = []
    for item in items:
        key = key_fn(item)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _query_needles(search_queries: Any = None, target_terms: Any = None) -> list[str]:
    values = []
    for item in [*_parse_list(search_queries), *_parse_list(target_terms)]:
        values.extend([item, *str(item).split()])
    return _unique_by([_clean_text(item) for item in values if len(_clean_text(item)) >= 2], lambda item: item)


def _video_text(video: dict[str, Any]) -> str:
    values = [video.get("title"), video.get("description"), video.get("desc"), video.get("dynamic"), *(video.get("tags") or [])]
    return _clean_text(" ".join(str(value) for value in values if value))


def _score_history_video(video: dict[str, Any], needles: list[str]) -> int:
    text = _video_text(video)
    if not text:
        return 0
    score = 0
    for needle in needles:
        if needle in text:
            score += 3 if len(needle) >= 4 else 1
    if any("\u5386\u53f2" in _clean_text(tag) for tag in video.get("tags") or []):
        score += 2
    if "\u5386\u53f2" in _clean_text(video.get("sourceQuery")):
        score += 1
    return score


def _bounded_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(number, maximum))


class HistoryTagScrapePlanner:
    """Build scrapeBilibiliHistoryTags.js-compatible request plans."""

    def __init__(self, project_dir: str | None = None):
        self.project_dir = project_dir or ""

    def build_plan(
        self,
        argv: list[Any] | None = None,
        env: dict[str, Any] | None = None,
        seed_files: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        env = env or {}
        options = {
            "outputPath": str(env.get("BILIBILI_HISTORY_TAG_CORPUS_PATH") or DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH),
            "pages": _bounded_int(env.get("BILIBILI_HISTORY_TAG_PAGES"), 1, 1, 10),
            "pageSize": _bounded_int(env.get("BILIBILI_HISTORY_TAG_PAGE_SIZE"), 20, 1, 50),
            "delayMs": _bounded_int(env.get("BILIBILI_HISTORY_TAG_DELAY_MS"), 5000, 0, 120000),
            "jitterMs": _bounded_int(env.get("BILIBILI_HISTORY_TAG_JITTER_MS"), 2500, 0, 120000),
            "seeds": _parse_list(env.get("BILIBILI_HISTORY_TAG_SEEDS")),
            "seedFile": str(env.get("BILIBILI_HISTORY_TAG_SEED_FILE") or ""),
            "write": env.get("BILIBILI_HISTORY_TAG_WRITE") == "1",
        }
        for raw_arg in argv or []:
            arg = str(raw_arg)
            if arg.startswith("--output="):
                options["outputPath"] = arg[len("--output=") :].strip()
            elif arg.startswith("--pages="):
                options["pages"] = _bounded_int(arg[len("--pages=") :], options["pages"], 1, 10)
            elif arg.startswith("--page-size="):
                options["pageSize"] = _bounded_int(arg[len("--page-size=") :], options["pageSize"], 1, 50)
            elif arg.startswith("--delay-ms="):
                options["delayMs"] = _bounded_int(arg[len("--delay-ms=") :], options["delayMs"], 0, 120000)
            elif arg.startswith("--jitter-ms="):
                options["jitterMs"] = _bounded_int(arg[len("--jitter-ms=") :], options["jitterMs"], 0, 120000)
            elif arg.startswith("--seed="):
                options["seeds"].append(arg[len("--seed=") :].strip())
            elif arg.startswith("--seeds="):
                options["seeds"].extend(_parse_list(arg[len("--seeds=") :]))
            elif arg.startswith("--seed-file="):
                options["seedFile"] = arg[len("--seed-file=") :].strip()
            elif arg == "--write":
                options["write"] = True
        if options["seedFile"]:
            options["seeds"].extend(_parse_list((seed_files or {}).get(options["seedFile"], "")))
        options["seeds"] = _unique_by([seed for seed in options["seeds"] if seed], lambda seed: seed)
        if not options["seeds"]:
            options["seeds"] = list(DEFAULT_HISTORY_TAG_SEEDS)

        requests = self._requests(options["seeds"], options["pages"], options["pageSize"])
        return {
            "ok": True,
            "outputPath": options["outputPath"],
            "pages": options["pages"],
            "pageSize": options["pageSize"],
            "delayMs": options["delayMs"],
            "jitterMs": options["jitterMs"],
            "write": options["write"],
            "seeds": options["seeds"],
            "seedFile": options["seedFile"],
            "collectComments": False,
            "collectDanmaku": False,
            "requests": requests,
            "summary": {
                "seeds": len(options["seeds"]),
                "requests": len(requests),
                "commentDanmakuScraping": False,
            },
        }

    def _requests(self, seeds: list[str], pages: int, page_size: int) -> list[dict[str, Any]]:
        requests = []
        for seed in seeds:
            encoded = quote(seed, safe="")
            for page in range(1, pages + 1):
                requests.append(
                    {
                        "seed": seed,
                        "page": page,
                        "url": f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={encoded}&page={page}&page_size={page_size}",
                        "referer": f"https://search.bilibili.com/all?keyword={encoded}",
                    }
                )
        return requests


class HistoryTagCorpusSummary:
    """Shape history-tag corpus merge results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("corpus", "tags", "videos", "runs")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class HistoryTagScrapePlanSummary:
    """Shape history-tag scrape plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("outputPath", "pages", "pageSize", "delayMs", "jitterMs", "write", "seeds", "requests", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class HistoryTagCorpusManager:
    """Merge and query Bilibili history-tag video corpus JSON contracts."""

    def __init__(self, generated_at: str | None = None):
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def merge(self, current: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
        current = current if isinstance(current, dict) else {}
        update = update if isinstance(update, dict) else {}
        tags = _unique_by([*(current.get("tags") or []), *(update.get("tags") or [])], lambda tag: _clean_text(tag.get("name") if isinstance(tag, dict) else tag))
        videos = _unique_by(
            [self._normalize_video(video) for video in [*(current.get("videos") or []), *(update.get("videos") or [])] if isinstance(video, dict)],
            lambda video: video.get("bvid") or video.get("sourceUrl"),
        )
        return {
            "version": 1,
            "updatedAt": self.generated_at,
            "tags": tags,
            "videos": videos,
            "runs": [*(current.get("runs") or []), *(update.get("runs") or [])],
        }

    def videos_for_search(self, corpus: dict[str, Any] | None, search_queries: Any = None, target_terms: Any = None, limit: int = 20) -> list[dict[str, Any]]:
        needles = _query_needles(search_queries, target_terms)
        fallback_needles = ["\u5386\u53f2"]
        scored = []
        for video in (corpus or {}).get("videos") or []:
            if not isinstance(video, dict):
                continue
            score = _score_history_video(video, needles if needles else fallback_needles)
            if video.get("bvid") and score > 0:
                scored.append({"video": video, "score": score})
        scored.sort(key=lambda item: (-item["score"], -float(item["video"].get("replyCount") or 0)))
        capped = scored[: max(1, int(limit or 20))]
        return _unique_by([self._search_result(item["video"]) for item in capped], lambda video: video.get("bvid"))

    def _normalize_video(self, video: dict[str, Any]) -> dict[str, Any]:
        bvid = str(video.get("bvid") or "").strip()
        aid = "" if video.get("aid") is None else str(video.get("aid"))
        return {
            **video,
            "bvid": bvid,
            "aid": aid,
            "title": _clean_title(video.get("title"), bvid),
            "sourceUrl": video.get("sourceUrl") or (f"https://www.bilibili.com/video/{bvid}/" if bvid else ""),
            "tags": _unique_by(_parse_list(video.get("tags")), _clean_text),
            "sourceQuery": str(video.get("sourceQuery") or "").strip(),
            "replyCount": self._number(video.get("replyCount")),
        }

    def _search_result(self, video: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": f"video-1-{video.get('aid') or video.get('bvid')}",
            "kind": "video",
            "bvid": video.get("bvid"),
            "oid": str(video.get("aid") or ""),
            "replyType": 1,
            "title": video.get("title") or video.get("bvid"),
            "desc": video.get("description") or video.get("desc") or "",
            "sourceUrl": video.get("sourceUrl") or f"https://www.bilibili.com/video/{video.get('bvid')}/",
            "replyCount": self._number(video.get("replyCount")),
            "tags": video.get("tags") if isinstance(video.get("tags"), list) else [],
            "source": "bilibili-history-tags",
        }

    def _number(self, value: Any) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0
