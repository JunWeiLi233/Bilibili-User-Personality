from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object
from python_backend.scrapers.rate_limiter import RateLimitPolicy


DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = "server/data/bilibiliHistoryTagCorpus.json"
# Expanded via browser-harness Bilibili tag discovery (2026-06-25)
# 189 curated history-relevant seeds matching JS bilibiliHistoryTags.js
DEFAULT_HISTORY_TAG_SEEDS = [
    "一战",
    "七下历史",
    "三国",
    "上高会战",
    "世界历史",
    "世界古代史",
    "世界近代史",
    "中世纪",
    "中东",
    "中华",
    "中华上下五千年",
    "中国",
    "中国历代疆域变化",
    "中国历史",
    "中国历史动画",
    "中国古代史",
    "中国文化",
    "中国现代史",
    "中国近代史",
    "中国风",
    "中外历史纲要",
    "中晚唐",
    "中考历史",
    "乌克兰",
    "乾隆",
    "二战",
    "五代十国",
    "亚历山大大帝",
    "人文历史",
    "人文历史档案馆",
    "人文历史档案馆2022第二季",
    "会津战争",
    "伯罗奔尼撒战争",
    "俄乌冲突",
    "俄乌战争",
    "俄罗斯",
    "儒家思想",
    "八下历史",
    "军事",
    "军事历史",
    "冷战",
    "初中历史",
    "华夏",
    "南北朝",
    "博物馆",
    "历史",
    "历史事件",
    "历史人物",
    "历史剧",
    "历史动画",
    "历史地图",
    "历史复习",
    "历史故事",
    "历史知识",
    "历史科普",
    "历史老师",
    "历史解说",
    "历史课本",
    "历史课程",
    "古代史",
    "古墓",
    "古希腊",
    "古文复兴运动",
    "古装剧",
    "史图馆",
    "史记",
    "周朝",
    "唐代",
    "唐朝",
    "商朝",
    "嘉靖",
    "国际关系",
    "国际关系史",
    "国际形势",
    "地图",
    "地方",
    "地理",
    "夏朝",
    "多尔衮",
    "大唐",
    "大唐兴亡三百年",
    "大明",
    "大明王朝1566",
    "大清",
    "孙中山",
    "安史之乱",
    "宋史",
    "宋夏战争",
    "宋朝",
    "宗教",
    "岳飞",
    "幕末",
    "庆历新政",
    "康熙",
    "开元盛世",
    "德国",
    "德川庆喜",
    "战争",
    "战争史",
    "战役",
    "战略",
    "抗日战争",
    "拿破仑",
    "文化",
    "文化自信",
    "文化遗产",
    "文明",
    "文物",
    "新选组",
    "日本",
    "日本战国",
    "明史",
    "明朝",
    "晋朝",
    "晚唐",
    "曾国藩",
    "朝代",
    "李世民",
    "李渊",
    "李隆基",
    "杯酒释兵权",
    "架空历史",
    "梦华录",
    "梦回唐朝",
    "欧洲",
    "武则天",
    "殷墟",
    "民国",
    "汉代",
    "汉朝",
    "河姆渡",
    "法国",
    "法门寺",
    "波黑",
    "洪秀全",
    "海瑞",
    "清史",
    "清平乐",
    "清朝",
    "爆笑中国历史",
    "玄武门之变",
    "甲午战争",
    "疆域",
    "皇帝",
    "盛唐",
    "看动画学历史知识",
    "科技考古",
    "秦代",
    "秦始皇",
    "秦始皇陵",
    "秦汉",
    "穿越",
    "第一次世界大战",
    "箱馆战争",
    "红山文化",
    "织田信长",
    "统治",
    "考古",
    "考古专业",
    "考古学",
    "良渚文化",
    "苏轼",
    "英国",
    "英荷战争",
    "范仲淹",
    "觉醒年代",
    "解放军",
    "讲历史张老师全121集",
    "贞观之治",
    "资本主义萌芽",
    "赵匡胤",
    "赵构",
    "辛亥革命",
    "近代史",
    "通俗历史",
    "金沙",
    "陵西大墓",
    "隋朝",
    "雅典",
    "雍正",
    "马王堆",
    "高一历史",
    "高三历史",
    "高中历史",
    "高二历史",
    "高考历史",
    "鸟羽伏见之战",
    "鸦片战争",
    "元朝",
    "春秋",
    "战国",
    "楚汉",
    "蒙古帝国",
    "丝绸之路",
    "敦煌",
    "黄袍加身",
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
        options.update(
            RateLimitPolicy(
                min_delay_ms=options["delayMs"],
                jitter_ms=options["jitterMs"],
                block_cooldown_ms=0,
            ).to_history_tag_options()
        )

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


class HistoryTagCorpusContractComparator:
    """Compare history-tag corpus merge results using the JS/Python JSON contract."""

    def __init__(self, summary: HistoryTagCorpusSummary | None = None):
        self.summary = summary or HistoryTagCorpusSummary()

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


class HistoryTagScrapePlanContractComparator:
    """Compare history-tag scrape plans using the JS/Python JSON contract."""

    def __init__(self, summary: HistoryTagScrapePlanSummary | None = None):
        self.summary = summary or HistoryTagScrapePlanSummary()

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


class HistoryTagMetadataScraper:
    """Scrape Bilibili search metadata for the standalone history-tag corpus."""

    def __init__(
        self,
        fetch_json=None,
        wait_fn=None,
        clock=None,
        jitter_fn=None,
    ):
        self.fetch_json = fetch_json or self._fetch_json
        self.wait_fn = wait_fn or self._wait
        self.clock = clock or self._now
        self.jitter_fn = jitter_fn or self._jitter

    def scrape(self, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options if isinstance(options, dict) else {}
        seeds = _parse_list(options.get("seeds")) or list(DEFAULT_HISTORY_TAG_SEEDS)
        pages = _bounded_int(options.get("pages"), 1, 1, 10)
        page_size = _bounded_int(options.get("pageSize"), 20, 1, 50)
        delay_ms = max(0, _bounded_int(options.get("delayMs"), 0, 0, 120000))
        jitter_ms = max(0, _bounded_int(options.get("jitterMs"), 0, 0, 120000))
        requests = HistoryTagScrapePlanner()._requests(seeds, pages, page_size)
        videos: list[dict[str, Any]] = []
        warnings: list[str] = []
        failed_seeds: set[str] = set()

        for request in requests:
            if request["seed"] in failed_seeds:
                continue
            if videos and delay_ms > 0:
                self.wait_fn(delay_ms + self.jitter_fn(jitter_ms))
            try:
                payload = self.fetch_json(request["url"], request["referer"])
                if not isinstance(payload, dict) or payload.get("code") != 0:
                    message = payload.get("message") if isinstance(payload, dict) else ""
                    raise ValueError(message or f"Bilibili API code {payload.get('code') if isinstance(payload, dict) else 'invalid'}")
                for item in ((payload.get("data") or {}).get("result") or []):
                    video = self._video_from_item(item, request["seed"])
                    if video:
                        videos.append(video)
            except Exception as exc:
                warnings.append(f"{request['seed']} page {request['page']}: {exc}")
                failed_seeds.add(request["seed"])
                continue

        unique_videos = _unique_by(videos, lambda video: video.get("bvid"))
        return {
            "tags": _unique_by([{"name": seed, "source": "seed"} for seed in seeds], lambda tag: _clean_text(tag.get("name"))),
            "videos": unique_videos,
            "runs": [
                {
                    "at": self.clock(),
                    "seeds": seeds,
                    "pages": pages,
                    "pageSize": page_size,
                    "videosFound": len(unique_videos),
                    "warnings": warnings,
                }
            ],
            "warnings": warnings,
        }

    def _video_from_item(self, item: Any, seed: str) -> dict[str, Any] | None:
        if not isinstance(item, dict) or not item.get("bvid"):
            return None
        bvid = str(item.get("bvid") or "").strip()
        return {
            "bvid": bvid,
            "aid": item.get("aid") or item.get("id") or "",
            "title": _clean_title(item.get("title"), bvid),
            "description": _clean_title(item.get("description") or item.get("desc") or ""),
            "sourceUrl": item.get("arcurl") or f"https://www.bilibili.com/video/{bvid}/",
            "replyCount": self._number(item.get("review") or item.get("comment") or 0),
            "tags": _unique_by([seed, *_parse_list(item.get("tag") or item.get("tags"))], _clean_text),
            "sourceQuery": seed,
            "scrapedAt": self.clock(),
        }

    @staticmethod
    def _number(value: Any) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _wait(ms: int) -> None:
        time.sleep(max(0, ms) / 1000)

    @staticmethod
    def _jitter(jitter_ms: int) -> int:
        return random.randrange(max(1, int(jitter_ms))) if jitter_ms > 0 else 0

    @staticmethod
    def _fetch_json(url: str, referer: str) -> dict[str, Any]:
        request = Request(
            url,
            headers={
                "accept": "application/json, text/plain, */*",
                "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                "referer": referer,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            },
        )
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8-sig"))


class HistoryTagMetadataScrapeCommandRequest:
    """Run the standalone Bilibili history-tag metadata scrape command."""

    VALUE_OPTIONS = {
        "--output",
        "--pages",
        "--page-size",
        "--delay-ms",
        "--jitter-ms",
        "--seed",
        "--seeds",
        "--seed-file",
    }

    def __init__(
        self,
        argv: list[Any] | None = None,
        *,
        env: dict[str, Any] | None = None,
        fetch_json=None,
        wait_fn=None,
        clock=None,
        jitter_fn=None,
    ):
        self.argv = [str(item) for item in argv] if argv is not None else []
        self.env = env or {}
        self.scraper = HistoryTagMetadataScraper(fetch_json=fetch_json, wait_fn=wait_fn, clock=clock, jitter_fn=jitter_fn)
        self.generated_at = clock

    def run(self) -> dict[str, Any]:
        plan = self._build_plan()
        scraped = self.scraper.scrape(plan)
        current = HistoryTagCorpusLoader(plan["outputPath"]).load()
        merged = HistoryTagCorpusManager(generated_at=self._now()).merge(current, scraped)
        if plan["write"]:
            self._write_monolithic_corpus(plan["outputPath"], merged)
        return {
            "ok": True,
            "outputPath": plan["outputPath"],
            "seeds": plan["seeds"],
            "pages": plan["pages"],
            "pageSize": plan["pageSize"],
            "delayMs": plan["delayMs"],
            "jitterMs": plan["jitterMs"],
            "write": plan["write"],
            "collectComments": False,
            "collectDanmaku": False,
            "videosFound": len(scraped.get("videos") or []),
            "corpusVideos": len(merged.get("videos") or []),
            "warnings": scraped.get("warnings") or [],
            "corpus": merged,
        }

    def _build_plan(self) -> dict[str, Any]:
        argv = self._normalize_argv(self.argv)
        seed_files = self._seed_files(argv)
        return HistoryTagScrapePlanner().build_plan(argv=argv, env=self.env, seed_files=seed_files)

    def _seed_files(self, argv: list[str]) -> dict[str, str]:
        paths = []
        env_path = str(self.env.get("BILIBILI_HISTORY_TAG_SEED_FILE") or "").strip()
        if env_path:
            paths.append(env_path)
        for arg in argv:
            if arg.startswith("--seed-file="):
                paths.append(arg[len("--seed-file=") :].strip())
        result = {}
        for path in paths:
            if not path:
                continue
            try:
                result[path] = Path(path).read_text(encoding="utf-8-sig")
            except OSError:
                result[path] = ""
        return result

    def _normalize_argv(self, argv: list[str]) -> list[str]:
        normalized: list[str] = []
        index = 0
        while index < len(argv):
            arg = argv[index]
            if arg in self.VALUE_OPTIONS and index + 1 < len(argv):
                normalized.append(f"{arg}={argv[index + 1]}")
                index += 2
                continue
            normalized.append(arg)
            index += 1
        return normalized

    def _now(self) -> str:
        return self.scraper.clock()

    def _write_monolithic_corpus(self, output_path: str | Path, corpus: dict[str, Any]) -> None:
        payload = {
            "version": 1,
            "updatedAt": corpus.get("updatedAt") or self._now(),
            "tags": corpus.get("tags") if isinstance(corpus.get("tags"), list) else [],
            "videos": corpus.get("videos") if isinstance(corpus.get("videos"), list) else [],
            "runs": corpus.get("runs") if isinstance(corpus.get("runs"), list) else [],
        }
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class HistoryTagCorpusManager:
    """Merge and query Bilibili history-tag video corpus JSON contracts."""

    def __init__(self, generated_at: str | None = None):
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def merge_result(self, current: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
        corpus = self.merge(current, update)
        return {"ok": True, "corpus": corpus, "tags": len(corpus["tags"]), "videos": len(corpus["videos"]), "runs": len(corpus["runs"])}

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


class HistoryTagCorpusLoader:
    """Read history-tag corpus contracts from monolithic JSON or split shard manifests."""

    DEFAULT_CORPUS = {"version": 1, "updatedAt": None, "tags": [], "videos": [], "runs": []}

    def __init__(self, path: str | Path, fallback: dict[str, Any] | None = None):
        self.path = Path(path)
        self.fallback = dict(fallback or self.DEFAULT_CORPUS)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(self.fallback)
        payload = self._read_json_object(self.path)
        if not isinstance(payload, dict):
            return dict(self.fallback)
        if payload.get("storage") != "split":
            return self._with_lists(payload)
        return {
            **payload,
            "tags": self._hydrate_files(payload.get("tagFiles"), "tags", payload.get("tags")),
            "videos": self._hydrate_files(payload.get("videoFiles"), "videos", payload.get("videos")),
            "runs": self._hydrate_files(payload.get("runFiles"), "runs", payload.get("runs")),
        }

    def _with_lists(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            **payload,
            "tags": payload.get("tags") if isinstance(payload.get("tags"), list) else [],
            "videos": payload.get("videos") if isinstance(payload.get("videos"), list) else [],
            "runs": payload.get("runs") if isinstance(payload.get("runs"), list) else [],
        }

    def _hydrate_files(self, file_paths: Any, key: str, fallback: Any = None) -> list[Any]:
        if not isinstance(file_paths, list):
            return list(fallback) if isinstance(fallback, list) else []
        items = []
        for file_path in file_paths:
            if not isinstance(file_path, str) or not file_path.strip():
                continue
            shard = self._read_json_object(self.path.parent / file_path)
            if isinstance(shard, dict) and isinstance(shard.get(key), list):
                items.extend(shard[key])
        return items

    def _read_json_object(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        payload = JsonContractReader().read_value(path, None)
        return payload if isinstance(payload, dict) else None


class HistoryTagCorpusShardWriter:
    """Write history-tag corpora into split tag, video, and run shard manifests."""

    def __init__(self, path: str | Path, max_shard_bytes: Any = 64 * 1024):
        self.path = Path(path)
        self.max_shard_bytes = max(1024, self._payload_max_shard_bytes(max_shard_bytes))

    def write(
        self,
        *,
        tags: Any,
        videos: Any,
        runs: Any,
        manifest: dict[str, Any] | None = None,
    ) -> None:
        manifest = dict(manifest or {})
        tags = self._array_values(tags)
        videos = self._array_values(videos)
        runs = self._array_values(runs)
        tag_files = self._write_shards(tags, "tags", self._tags_dir(), "tags", manifest)
        video_files = self._write_shards(videos, "videos", self._videos_dir(), "videos", manifest)
        run_files = self._write_shards(runs, "runs", self._runs_dir(), "runs", manifest)
        payload = {
            **manifest,
            "version": manifest.get("version", 1),
            "storage": "split",
            "shardMaxBytes": self.max_shard_bytes,
            "tagFiles": tag_files,
            "tagCount": len(tags),
            "videoFiles": video_files,
            "videoCount": len(videos),
            "runFiles": run_files,
            "runCount": len(runs),
        }
        self._write_json(self.path, payload)
        self._remove_stale_shards(self._tags_dir(), tag_files, r"tags-\d{4}\.json")
        self._remove_stale_shards(self._videos_dir(), video_files, r"videos-\d{4}\.json")
        self._remove_stale_shards(self._runs_dir(), run_files, r"runs-\d{4}\.json")

    @staticmethod
    def _array_values(value: Any) -> list[Any]:
        return value if isinstance(value, list) else []

    @staticmethod
    def _payload_max_shard_bytes(value: Any) -> int:
        try:
            return int(value or 64 * 1024)
        except (TypeError, ValueError):
            return 64 * 1024

    def _tags_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.tags"

    def _videos_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.videos"

    def _runs_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.runs"

    def _write_shards(
        self,
        values: list[Any],
        file_stem: str,
        directory: Path,
        key: str,
        manifest: dict[str, Any],
    ) -> list[str]:
        directory.mkdir(parents=True, exist_ok=True)
        shards = self._split_values(values, key, manifest)
        files: list[str] = []
        for index, shard_values in enumerate(shards, start=1):
            name = f"{file_stem}-{index:04d}.json"
            self._write_json(directory / name, self._build_shard_payload(manifest, index, len(shards), key, shard_values))
            files.append(f"{directory.name}/{name}")
        return files

    def _split_values(self, values: list[Any], key: str, manifest: dict[str, Any]) -> list[list[Any]]:
        if not values:
            return [[]]
        shards: list[list[Any]] = []
        current: list[Any] = []
        for value in values:
            candidate = [*current, value]
            if current and self._json_bytes(self._build_shard_payload(manifest, 9999, 9999, key, candidate)) > self.max_shard_bytes:
                shards.append(current)
                current = [value]
            else:
                current = candidate
        if current:
            shards.append(current)
        return shards

    def _remove_stale_shards(self, directory: Path, kept_files: list[str], pattern: str) -> None:
        kept_names = {Path(path).name for path in kept_files}
        regex = re.compile(pattern, re.IGNORECASE)
        if not directory.exists():
            return
        for path in directory.iterdir():
            if path.is_file() and regex.fullmatch(path.name) and path.name not in kept_names:
                path.unlink()

    @staticmethod
    def _build_shard_payload(
        manifest: dict[str, Any],
        shard: int,
        shard_count: int,
        key: str,
        values: list[Any],
    ) -> dict[str, Any]:
        return {
            "version": manifest.get("version", 1),
            "updatedAt": manifest.get("updatedAt") or None,
            "shard": shard,
            "shardCount": shard_count,
            key: values,
        }

    @staticmethod
    def _json_bytes(payload: dict[str, Any]) -> int:
        return len((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class HistoryTagCorpusShardWriteSummary:
    """Shape history-tag split write results into the JS/Python comparator contract."""

    RESULT_KEYS = ("manifest", "tags", "videos", "runs")
    MANIFEST_KEYS = (
        "version",
        "updatedAt",
        "storage",
        "shardMaxBytes",
        "tagCount",
        "videoCount",
        "runCount",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}

    def summarize_manifest(self, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
        manifest = manifest if isinstance(manifest, dict) else {}
        return {key: manifest.get(key) for key in self.MANIFEST_KEYS if key in manifest}


class HistoryTagCorpusShardWriteContractComparator:
    """Compare history-tag split write summaries using the JS/Python JSON contract."""

    def __init__(self, summary: HistoryTagCorpusShardWriteSummary | None = None):
        self.summary = summary or HistoryTagCorpusShardWriteSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = self.summary.summarize(python_result)
        js_result = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {"ok": not mismatches, "mismatches": mismatches, "python": python_result, "js": js_result}


class HistoryTagCorpusShardWriteRunner:
    """Write a JS-compatible split history-tag corpus from a JSON payload file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        output_path = Path(str(payload.get("outputPath") or ""))
        if not str(output_path):
            raise ValueError("payload outputPath is required")
        tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
        videos = payload.get("videos") if isinstance(payload.get("videos"), list) else []
        runs = payload.get("runs") if isinstance(payload.get("runs"), list) else []
        manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
        writer = HistoryTagCorpusShardWriter(
            output_path,
            max_shard_bytes=HistoryTagCorpusShardWriter._payload_max_shard_bytes(payload.get("maxShardBytes")),
        )
        writer.write(tags=tags, videos=videos, runs=runs, manifest=manifest)
        loaded = HistoryTagCorpusLoader(output_path).load()
        return {
            "ok": True,
            "outputPath": str(output_path),
            "manifest": HistoryTagCorpusShardWriteSummary().summarize_manifest(loaded),
            "tags": len(loaded.get("tags") or []),
            "videos": len(loaded.get("videos") or []),
            "runs": len(loaded.get("runs") or []),
        }

    def _read_payload(self) -> dict[str, Any]:
        return JsonContractReader().read_object(self.payload_path)


class HistoryTagCorpusShardWritePayloadContractComparator:
    """Compare history-tag split write payload output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = HistoryTagCorpusShardWriteSummary()
        self.comparator = HistoryTagCorpusShardWriteContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagCorpusShardWriteRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class HistoryTagCorpusRunner:
    """Merge Bilibili history-tag corpus JSON contracts from files."""

    def __init__(self, current_path: str | Path, update_path: str | Path, generated_at: str | None = None):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.manager = HistoryTagCorpusManager(generated_at=generated_at)

    def run(self) -> dict[str, Any]:
        current = HistoryTagCorpusLoader(self.current_path).load()
        update = HistoryTagCorpusLoader(self.update_path, fallback={"tags": [], "videos": [], "runs": []}).load()
        return self.manager.merge_result(current, update)


class HistoryTagCorpusPayloadContractComparator:
    """Compare file-backed history-tag corpus merges against saved JS-compatible JSON."""

    def __init__(
        self,
        current_path: str | Path,
        update_path: str | Path,
        js_report_path: str | Path,
        generated_at: str | None = None,
    ):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.js_report_path = Path(js_report_path)
        self.generated_at = generated_at
        self.summary = HistoryTagCorpusSummary()
        self.comparator = HistoryTagCorpusContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagCorpusRunner(self.current_path, self.update_path, generated_at=self.generated_at).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class HistoryTagScrapePlanRunner:
    """Read a JS-compatible history-tag scrape payload and emit a dry-run request plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_json_object(self.payload_path, {})
        planner = HistoryTagScrapePlanner(project_dir=str(payload.get("projectDir") or payload.get("project_dir") or ""))
        return planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            seed_files=payload.get("seedFiles") if isinstance(payload.get("seedFiles"), dict) else {},
        )

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        return JsonContractReader(fallback).read_object(path)


class HistoryTagScrapePlanPayloadContractComparator:
    """Compare file-backed history-tag scrape plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = HistoryTagScrapePlanSummary()
        self.comparator = HistoryTagScrapePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagScrapePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class HistoryTagCorpusRequest:
    """Corpus-layer request for history-tag merge, scrape-plan, and split-write JSON contracts."""

    def __init__(
        self,
        current_path: str | Path = DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH,
        update_path: str | Path | None = None,
        *,
        generated_at: str | None = None,
        compare_js_report_path: str | Path | None = None,
        plan_payload_path: str | Path | None = None,
        write_payload_path: str | Path | None = None,
    ):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path) if update_path else None
        self.generated_at = generated_at
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.plan_payload_path = Path(plan_payload_path) if plan_payload_path else None
        self.write_payload_path = Path(write_payload_path) if write_payload_path else None

    def run(self) -> dict[str, Any]:
        if self.write_payload_path and self.compare_js_report_path:
            return HistoryTagCorpusShardWritePayloadContractComparator(
                self.write_payload_path,
                self.compare_js_report_path,
            ).compare()
        if self.write_payload_path:
            return HistoryTagCorpusShardWriteRunner(self.write_payload_path).run()
        if self.plan_payload_path and self.compare_js_report_path:
            return HistoryTagScrapePlanPayloadContractComparator(
                self.plan_payload_path,
                self.compare_js_report_path,
            ).compare()
        if self.plan_payload_path:
            return HistoryTagScrapePlanRunner(self.plan_payload_path).run()
        if not self.update_path:
            raise ValueError("update_path is required unless plan_payload_path or write_payload_path is provided")
        if self.compare_js_report_path:
            return HistoryTagCorpusPayloadContractComparator(
                self.current_path,
                self.update_path,
                self.compare_js_report_path,
                generated_at=self.generated_at,
            ).compare()
        return HistoryTagCorpusRunner(self.current_path, self.update_path, generated_at=self.generated_at).run()


class HistoryTagCorpusCommandRequest:
    """Argv-backed corpus-layer request for history-tag corpus commands."""

    def __init__(
        self,
        argv: list[Any] | None = None,
        *,
        env: dict[str, Any] | None = None,
        fetch_json=None,
        wait_fn=None,
        clock=None,
        jitter_fn=None,
    ):
        self.argv = argv
        self.env = dict(os.environ) if env is None else env
        self.fetch_json = fetch_json
        self.wait_fn = wait_fn
        self.clock = clock
        self.jitter_fn = jitter_fn

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Merge JS-compatible Bilibili history tag corpus JSON.")
        parser.add_argument("--current", default=DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH)
        parser.add_argument("--update", default="", help="History-tag scrape update JSON object.")
        parser.add_argument("--generated-at", default="")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible history-tag corpus report to compare.")
        parser.add_argument("--plan-payload", default="", help="Optional JSON payload for scrape option/request planning.")
        parser.add_argument("--write-payload", default="", help="Optional JSON payload for split history-tag corpus writing.")
        parser.add_argument("--output", default="")
        parser.add_argument("--pages", default="")
        parser.add_argument("--page-size", default="")
        parser.add_argument("--delay-ms", default="")
        parser.add_argument("--jitter-ms", default="")
        parser.add_argument("--seed", action="append", default=[])
        parser.add_argument("--seeds", default="")
        parser.add_argument("--seed-file", default="")
        parser.add_argument("--write", action="store_true")
        return parser

    def run(self) -> dict[str, Any]:
        parser = self.parser()
        raw_argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = parser.parse_args(raw_argv)
        if not args.update and not args.plan_payload and not args.write_payload:
            return HistoryTagMetadataScrapeCommandRequest(
                raw_argv if raw_argv is not None else sys.argv[1:],
                env=self.env,
                fetch_json=self.fetch_json,
                wait_fn=self.wait_fn,
                clock=self.clock,
                jitter_fn=self.jitter_fn,
            ).run()
        return HistoryTagCorpusRequest(
            current_path=args.current,
            update_path=args.update or None,
            generated_at=args.generated_at or None,
            compare_js_report_path=args.compare_js_report or None,
            plan_payload_path=args.plan_payload or None,
            write_payload_path=args.write_payload or None,
        ).run()
