from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any


def _clean_search_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return "".join(char for char in text if char.isalnum()).lower()


def _parse_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item or "").strip() for item in value if str(item or "").strip()]
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _unique_by_value(items: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def _squash_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _number_value(value: Any, fallback: int = 0) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not number == number:
        return fallback
    return max(0, int(number))


GENERIC_TARGET_SEARCH_NEEDLES = {
    _clean_search_text(item)
    for item in [
        "b站",
        "bilibili",
        "视频",
        "投稿",
        "合集",
        "全集",
        "完整版",
        "免费观看",
        "评论",
        "评论区",
        "弹幕",
        "热评",
        "回复",
        "互动",
        "讨论",
        "争议",
        "热点",
        "热门",
        "梗图",
        "名场面",
        "切片",
        "盘点",
        "复盘",
        "链接",
        "自取",
        "出处",
        "来源",
        "是什么梗",
        "什么意思",
    ]
}

AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES = {
    _clean_search_text(item)
    for item in [
        "问百度",
        "问百度有什么用",
    ]
}

STRICT_TARGET_RELEVANCE_NEEDLES = {
    _clean_search_text(item)
    for item in [
        "国际宅男联盟",
        "宅男联盟",
        "果蝇play",
        "不一一",
        "不一一评价",
        "就不一一评价了",
        "怕被删评",
        "怕被删评故发图",
        "单车变摩托",
        "第一次就看懂了",
        "鼻子占领大脑",
        "并非偶遇",
    ]
}

ASK_BAIDU_PRODUCT_NOISE_NEEDLES = [
    _clean_search_text(item)
    for item in [
        "百度文库",
        "百度网盘",
        "百度云",
        "百度APP",
        "百度地图",
        "百度百科",
        "百度贴吧",
        "百度翻译",
        "百度输入法",
        "百度公关",
        "公关一号位",
        "问百度陈睿",
        "陈睿演唱",
    ]
]


class VideoCommentFilter:
    """Pre-filter Bilibili comments by normalized dictionary needles."""

    def run_from_payload(
        self,
        comments_payload: Any,
        needles_payload: Any,
        extra_needles: list[Any] | None = None,
        dictionary_mode: bool = False,
        existing_terms_only: bool = False,
    ) -> dict[str, Any]:
        comments = comments_payload.get("comments") if isinstance(comments_payload, dict) else comments_payload
        if dictionary_mode:
            result = self.prefilter_comments_to_dictionary(
                comments if isinstance(comments, list) else [],
                needles_payload if isinstance(needles_payload, dict) else {},
                existing_terms_only=existing_terms_only,
                target_existing_terms=extra_needles or [],
            )
            return {"ok": True, **result}
        needles = needles_payload.get("needles") if isinstance(needles_payload, dict) else needles_payload
        result = self.filter_comments(
            comments if isinstance(comments, list) else [],
            needles if isinstance(needles, list) else [],
            extra_needles or [],
        )
        source_comments = comments if isinstance(comments, list) else []
        return {"ok": True, "before": len(source_comments), "after": len(result["comments"]), **result}

    def comment_matches_needle_set(self, message: Any, needle_set: set[str] | list[str] | tuple[str, ...]) -> bool:
        if not needle_set:
            return False
        clean = _clean_search_text(message)
        if not clean:
            return False
        for needle in needle_set:
            normalized = _clean_search_text(needle)
            if len(normalized) >= 2 and normalized in clean:
                return True
        return False

    def filter_comments(self, comments: list[Any] | None, needle_set: set[str] | list[str] | tuple[str, ...], extra_needles: list[Any] | None = None) -> dict[str, Any]:
        comments = comments if isinstance(comments, list) else []
        needles = {_clean_search_text(needle) for needle in (needle_set or []) if len(_clean_search_text(needle)) >= 2}
        for extra in extra_needles or []:
            clean = _clean_search_text(extra)
            if len(clean) >= 2:
                needles.add(clean)
        if not needles:
            return {"comments": comments, "needleCount": 0, "matched": len(comments), "applied": False}
        matched = [comment for comment in comments if isinstance(comment, dict) and self.comment_matches_needle_set(comment.get("message"), needles)]
        if not matched:
            return {"comments": comments, "needleCount": len(needles), "matched": 0, "applied": False}
        return {"comments": matched, "needleCount": len(needles), "matched": len(matched), "applied": True}

    def dictionary_entry_needles(self, entry: dict[str, Any] | None = None) -> list[str]:
        entry = entry if isinstance(entry, dict) else {}
        values = [
            entry.get("term"),
            *(entry.get("aliases") if isinstance(entry.get("aliases"), list) else []),
            *(entry.get("examples") if isinstance(entry.get("examples"), list) else []),
        ]
        seen: set[str] = set()
        needles: list[str] = []
        for value in values:
            clean = _clean_search_text(value)
            if len(clean) < 2 or clean in seen:
                continue
            seen.add(clean)
            needles.append(clean)
        return needles

    def dictionary_needle_set(self, dictionary: dict[str, Any] | None = None) -> set[str]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        needles: set[str] = set()
        for entry in dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []:
            if not isinstance(entry, dict):
                continue
            needles.update(self.dictionary_entry_needles(entry))
        return needles

    def prefilter_comments_to_dictionary(
        self,
        comments: list[Any] | None = None,
        dictionary: dict[str, Any] | None = None,
        existing_terms_only: bool = False,
        target_existing_terms: list[Any] | None = None,
    ) -> dict[str, Any]:
        comments = comments if isinstance(comments, list) else []
        if not existing_terms_only or not comments:
            return {"comments": comments, "applied": False, "needleCount": 0, "before": len(comments), "after": len(comments)}
        needle_set = self.dictionary_needle_set(dictionary)
        result = self.filter_comments(comments, needle_set, target_existing_terms or [])
        return {
            "comments": result["comments"],
            "applied": result["applied"],
            "needleCount": result["needleCount"],
            "before": len(comments),
            "after": len(result["comments"]),
        }


class VideoCommentFilterSummary:
    """Shape comment-filter output into the JS/Python comparator contract."""

    RESULT_KEYS = ("applied", "matched", "before", "after", "needleCount", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: self.normalized_value(result.get(key)) for key in self.RESULT_KEYS if key in result}

    def normalized_value(self, value: Any) -> Any:
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            return [self.comment_id(item) for item in value]
        return value

    def comment_id(self, comment: dict[str, Any]) -> Any:
        return comment.get("rpid") or comment.get("id") or comment.get("uid") or comment.get("message") or comment


class VideoCommentFilterContractComparator:
    """Compare comment filter payloads using normalized JS/Python contract fields."""

    def __init__(self, summary: VideoCommentFilterSummary | None = None):
        self.summary = summary or VideoCommentFilterSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {
                "key": key,
                "python": self.summary.normalized_value(python_result.get(key)),
                "js": self.summary.normalized_value(js_result.get(key)),
            }
            for key in self.summary.RESULT_KEYS
            if key in js_result and self.summary.normalized_value(python_result.get(key)) != self.summary.normalized_value(js_result.get(key))
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class VideoCommentFilterPayloadRunner:
    """Run comment pre-filtering from JSON contracts."""

    def __init__(
        self,
        comments_path: str | Path,
        needles_path: str | Path,
        extra_needles: list[str] | None = None,
        dictionary_mode: bool = False,
        existing_terms_only: bool = False,
    ):
        self.comments_path = Path(comments_path)
        self.needles_path = Path(needles_path)
        self.extra_needles = [self._decode_cli_value(item) for item in extra_needles or []]
        self.dictionary_mode = dictionary_mode
        self.existing_terms_only = existing_terms_only
        self.comment_filter = VideoCommentFilter()

    def run(self) -> dict[str, Any]:
        comments_payload = self._read_json(self.comments_path, [])
        needles_payload = self._read_json(self.needles_path, [])
        return self.comment_filter.run_from_payload(
            comments_payload,
            needles_payload,
            extra_needles=self.extra_needles,
            dictionary_mode=self.dictionary_mode,
            existing_terms_only=self.existing_terms_only,
        )

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _decode_cli_value(self, value: str) -> str:
        try:
            return json.loads(f'"{value}"')
        except json.JSONDecodeError:
            return value


class VideoCommentFilterPayloadContractComparator:
    """Compare Python comment filtering output against saved JS-compatible JSON."""

    def __init__(
        self,
        comments_path: str | Path,
        needles_path: str | Path,
        js_report_path: str | Path,
        extra_needles: list[str] | None = None,
        dictionary_mode: bool = False,
        existing_terms_only: bool = False,
    ):
        self.comments_path = Path(comments_path)
        self.needles_path = Path(needles_path)
        self.js_report_path = Path(js_report_path)
        self.extra_needles = extra_needles or []
        self.dictionary_mode = dictionary_mode
        self.existing_terms_only = existing_terms_only
        self.summary = VideoCommentFilterSummary()
        self.comparator = VideoCommentFilterContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = VideoCommentFilterPayloadRunner(
            self.comments_path,
            self.needles_path,
            self.extra_needles,
            self.dictionary_mode,
            self.existing_terms_only,
        ).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class VideoRelevanceFilter:
    """Rank and filter Bilibili video objects with JS-compatible relevance rules."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        videos = payload.get("videos") if isinstance(payload.get("videos"), list) else []
        search_queries = self._list_value(payload.get("searchQueries") or payload.get("searchQuery"))
        target_existing_terms = self._list_value(
            payload.get("targetExistingTerms") or payload.get("targetExistingTerm") or payload.get("targetTerms") or payload.get("targetTerm")
        )
        operation = str(payload.get("operation") or "sort").strip().lower()
        needles = self.search_needles_for_relevance(search_queries, target_existing_terms)
        if operation == "filter":
            result_videos = self.filter_relevant_videos(videos, search_queries, target_existing_terms)
        elif operation == "score":
            scores = [
                {"video": video, "score": self.relevance_score_for_video(video if isinstance(video, dict) else {}, needles)}
                for video in videos
            ]
            return {"ok": True, "operation": operation, "needles": needles, "scores": scores}
        else:
            operation = "sort"
            result_videos = self.sort_videos_by_relevance(videos, search_queries, target_existing_terms)
        return {"ok": True, "operation": operation, "needles": needles, "videos": result_videos}

    def search_query_needles(self, query: Any) -> list[str]:
        raw = str(query or "").strip()
        if not raw:
            return []
        return [_clean_search_text(item) for item in [raw, *re.split(r"\s+", raw)] if len(_clean_search_text(item)) >= 2]

    def _list_value(self, value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]

    def is_generic_target_search_needle(self, needle: Any) -> bool:
        return _clean_search_text(needle) in GENERIC_TARGET_SEARCH_NEEDLES

    def search_needles_for_relevance(self, search_queries: list[Any] | None = None, target_existing_terms: list[Any] | None = None) -> list[str]:
        target_needles = _unique_by_value([_clean_search_text(item) for item in target_existing_terms or [] if len(_clean_search_text(item)) >= 2])
        query_needles: list[str] = []
        for query in search_queries or []:
            for item in _parse_list(query):
                query_needles.extend(self.search_query_needles(item))
        if target_needles:
            query_needles = [item for item in query_needles if not self.is_generic_target_search_needle(item)]
        unique_query_needles = _unique_by_value([_clean_search_text(item) for item in query_needles if len(_clean_search_text(item)) >= 2])
        if not target_needles:
            return unique_query_needles
        query_needle_set = set(unique_query_needles)
        target_in_query = any(needle in query_needle_set for needle in target_needles)
        alias_query_needles = [needle for needle in unique_query_needles if needle not in target_needles]
        if alias_query_needles and not target_in_query:
            if any(needle in AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES for needle in target_needles):
                return [*alias_query_needles, *alias_query_needles, *unique_query_needles]
            return [*alias_query_needles, *alias_query_needles, *target_needles, *unique_query_needles]
        return [*target_needles, *target_needles, *unique_query_needles]

    def video_search_text(self, video: dict[str, Any] | None = None) -> str:
        video = video if isinstance(video, dict) else {}
        return _clean_search_text(" ".join(str(video.get(key) or "") for key in ["title", "desc", "description", "dynamic"]))

    def relevance_score_for_video(self, video: dict[str, Any] | None = None, needles: list[Any] | None = None) -> int:
        text = self.video_search_text(video)
        if not text:
            return 0
        score = 0
        for needle in needles or []:
            clean = _clean_search_text(needle)
            if clean and clean in text:
                score += min(12, max(1, len(clean)))
        return score

    def strict_target_relevance_score_for_video(self, video: dict[str, Any] | None = None, target_existing_terms: list[Any] | None = None) -> int:
        target_needles = _unique_by_value([_clean_search_text(item) for item in target_existing_terms or [] if len(_clean_search_text(item)) >= 2])
        return self.relevance_score_for_video(video, target_needles)

    def sort_videos_by_relevance(
        self,
        videos: list[dict[str, Any]] | None = None,
        search_queries: list[Any] | None = None,
        target_existing_terms: list[Any] | None = None,
    ) -> list[dict[str, Any]]:
        videos = videos if isinstance(videos, list) else []
        needles = self.search_needles_for_relevance(search_queries or [], target_existing_terms or [])
        if not needles:
            return videos
        indexed = [
            {"video": video, "index": index, "score": self.relevance_score_for_video(video if isinstance(video, dict) else {}, needles)}
            for index, video in enumerate(videos)
        ]
        indexed.sort(key=lambda item: (-item["score"], item["index"]))
        return [item["video"] for item in indexed]

    def required_ascii_anchors_for_search(self, search_queries: list[Any] | None = None) -> list[str]:
        anchors: list[str] = []
        for query in search_queries or []:
            for item in _parse_list(query):
                for token in re.split(r"\s+", str(item or "")):
                    if not token or self.is_generic_target_search_needle(token):
                        continue
                    text = _clean_search_text(token)
                    if not re.search(r"[\u3400-\u9fff]", text):
                        continue
                    anchors.extend(match.group(0).lower() for match in re.finditer(r"[a-z0-9]{2,}", text, flags=re.IGNORECASE))
        return _unique_by_value(anchors)

    def targets_ask_baidu_term(self, target_existing_terms: list[Any] | None = None) -> bool:
        return any(_clean_search_text(item) in AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES for item in target_existing_terms or [])

    def targets_require_strict_relevance(self, target_existing_terms: list[Any] | None = None) -> bool:
        return any(_clean_search_text(item) in STRICT_TARGET_RELEVANCE_NEEDLES for item in target_existing_terms or [])

    def is_ask_baidu_product_noise_video(self, video: dict[str, Any] | None = None) -> bool:
        text = self.video_search_text(video)
        return bool(text and any(needle and needle in text for needle in ASK_BAIDU_PRODUCT_NOISE_NEEDLES))

    def filter_relevant_videos(
        self,
        videos: list[dict[str, Any]] | None = None,
        search_queries: list[Any] | None = None,
        target_existing_terms: list[Any] | None = None,
    ) -> list[dict[str, Any]]:
        videos = videos if isinstance(videos, list) else []
        search_queries = search_queries or []
        target_existing_terms = target_existing_terms or []
        needles = self.search_needles_for_relevance(search_queries, target_existing_terms)
        if not needles:
            return videos
        reject_ask_baidu_product_noise = self.targets_ask_baidu_term(target_existing_terms)
        require_strict_target_relevance = self.targets_require_strict_relevance(target_existing_terms)
        required_ascii_anchors = self.required_ascii_anchors_for_search(search_queries)
        matched: list[dict[str, Any]] = []
        for video in videos:
            if reject_ask_baidu_product_noise and self.is_ask_baidu_product_noise_video(video):
                continue
            text = self.video_search_text(video)
            if required_ascii_anchors and not any(anchor in text for anchor in required_ascii_anchors):
                continue
            if require_strict_target_relevance:
                if self.strict_target_relevance_score_for_video(video, target_existing_terms) > 0:
                    matched.append(video)
                continue
            if self.relevance_score_for_video(video, needles) > 0:
                matched.append(video)
        return matched


class VideoRelevanceSummary:
    """Shape video relevance output into the JS/Python comparator contract."""

    RESULT_KEYS = ("operation", "needles", "videos", "scores")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: self.normalized_value(result.get(key)) for key in self.RESULT_KEYS if key in result}

    def normalized_value(self, value: Any) -> Any:
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            if all("video" in item and "score" in item for item in value):
                return [{"bvid": self.video_id(item.get("video")), "score": item.get("score")} for item in value]
            if all("bvid" in item or "aid" in item for item in value):
                return [self.video_id(item) for item in value]
        return value

    def video_id(self, video: Any) -> Any:
        if not isinstance(video, dict):
            return video
        return video.get("bvid") or video.get("aid") or video.get("id") or video


class VideoRelevanceContractComparator:
    """Compare video relevance payloads using normalized JS/Python contract fields."""

    def __init__(self, summary: VideoRelevanceSummary | None = None):
        self.summary = summary or VideoRelevanceSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": self.summary.normalized_value(python_result.get(key)), "js": self.summary.normalized_value(js_result.get(key))}
            for key in self.summary.RESULT_KEYS
            if key in js_result and self.summary.normalized_value(python_result.get(key)) != self.summary.normalized_value(js_result.get(key))
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class VideoRelevancePayloadRunner:
    """Run JS-compatible video relevance ranking/filtering from a JSON contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.relevance = VideoRelevanceFilter()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        return self.relevance.run_from_payload(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)


class VideoRelevancePayloadContractComparator:
    """Compare Python video relevance results against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoRelevanceSummary()
        self.comparator = VideoRelevanceContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = VideoRelevancePayloadRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class VideoContextBuilder:
    """Build JS-compatible video context, target evidence, and collection diagnostics."""

    def __init__(self):
        self.relevance = VideoRelevanceFilter()

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        videos = self._list_value(payload.get("videos"))
        discovered_videos = self._list_value(payload.get("discoveredVideos"))
        discovery_context_videos = self._list_value(payload.get("discoveryContextVideos"))
        comments = self._list_value(payload.get("comments"))
        search_queries = self._list_value(payload.get("searchQueries") or payload.get("searchQuery"))
        target_existing_terms = self._list_value(
            payload.get("targetExistingTerms") or payload.get("targetExistingTerm") or payload.get("targetTerms") or payload.get("targetTerm")
        )
        training_text = payload.get("trainingText") or ""
        keyword_training = payload.get("keywordTraining") if isinstance(payload.get("keywordTraining"), dict) else None
        context_videos = self.video_context_sources(videos, discovery_context_videos if discovery_context_videos else discovered_videos)
        return {
            "ok": True,
            "videoContextText": self.build_video_context_text(context_videos),
            "videoObjectEvidenceText": self.build_target_video_object_evidence_text(context_videos, search_queries, target_existing_terms),
            "contextSourceUrls": self.video_context_source_urls(context_videos),
            "diagnostics": self.build_collection_diagnostics(
                discovered_videos=discovered_videos,
                discovery_context_videos=discovery_context_videos,
                videos=videos,
                comments=comments,
                training_text=training_text,
                target_existing_terms=target_existing_terms,
                keyword_training=keyword_training,
            ),
        }

    def build_video_context_text(self, videos: list[dict[str, Any]] | None = None) -> str:
        items: list[str] = []
        for video in videos or []:
            if not isinstance(video, dict):
                continue
            for key in ["title", "desc", "description"]:
                text = _squash_text(video.get(key))
                if text:
                    items.append(text)
        return "\n".join(f"Bilibili video context: {item}" for item in _unique_by_value(items))

    def build_target_video_object_evidence_text(
        self,
        videos: list[dict[str, Any]] | None = None,
        search_queries: list[Any] | None = None,
        target_existing_terms: list[Any] | None = None,
    ) -> str:
        if not target_existing_terms:
            return ""
        needles = self.relevance.search_needles_for_relevance(search_queries or [], target_existing_terms or [])
        if not needles:
            return ""
        items: list[str] = []
        for video in videos or []:
            if not isinstance(video, dict):
                continue
            for key in ["title", "desc", "description"]:
                text = _squash_text(video.get(key))
                if text and any(needle in text for needle in needles):
                    items.append(text)
        return "\n".join(f"Bilibili public video title: {item}" for item in _unique_by_value(items))

    def video_context_sources(self, videos: list[dict[str, Any]] | None = None, discovered_videos: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for video in [*(videos or []), *(discovered_videos or [])]:
            if not isinstance(video, dict):
                continue
            key = f"{video.get('bvid') or ''}\n{video.get('sourceUrl') or ''}\n{video.get('title') or ''}"
            if key in seen:
                continue
            seen.add(key)
            result.append(video)
        return result

    def video_context_source_urls(self, videos: list[dict[str, Any]] | None = None, discovered_videos: list[dict[str, Any]] | None = None) -> list[str]:
        urls = [
            str(video.get("sourceUrl") or "").strip()
            for video in [*(videos or []), *(discovered_videos or [])]
            if isinstance(video, dict) and str(video.get("sourceUrl") or "").strip()
        ]
        return _unique_by_value(urls)

    def _list_value(self, value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]

    def sample_videos_for_diagnostics(self, videos: list[dict[str, Any]] | None = None) -> list[dict[str, str]]:
        samples: list[dict[str, str]] = []
        for video in (videos or [])[:5]:
            if not isinstance(video, dict):
                video = {}
            samples.append(
                {
                    "bvid": str(video.get("bvid") or "").strip(),
                    "title": _squash_text(video.get("title"))[:120],
                    "sourceUrl": str(video.get("sourceUrl") or "").strip(),
                }
            )
        return samples

    def target_text_hits_for_diagnostics(self, training_text: Any = "", target_existing_terms: list[Any] | None = None) -> list[dict[str, Any]]:
        haystack = _clean_search_text(training_text)
        if not haystack:
            return []
        hits: list[dict[str, Any]] = []
        for term in _unique_by_value([str(item or "").strip() for item in target_existing_terms or [] if str(item or "").strip()]):
            needle = _clean_search_text(term)
            if len(needle) < 2:
                continue
            count = haystack.count(needle)
            if count > 0:
                hits.append({"term": term, "count": count})
        return hits

    def build_collection_diagnostics(
        self,
        discovered_videos: list[dict[str, Any]] | None = None,
        discovery_context_videos: list[dict[str, Any]] | None = None,
        videos: list[dict[str, Any]] | None = None,
        comments: list[dict[str, Any]] | None = None,
        training_text: Any = "",
        target_existing_terms: list[Any] | None = None,
        keyword_training: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        discovered_videos = discovered_videos if isinstance(discovered_videos, list) else []
        discovery_context_videos = discovery_context_videos if isinstance(discovery_context_videos, list) else []
        videos = videos if isinstance(videos, list) else []
        comments = comments if isinstance(comments, list) else []
        keyword_training = keyword_training if isinstance(keyword_training, dict) else {}
        accepted_terms = _unique_by_value(
            [
                str(entry.get("term") or "").strip()
                for entry in [*(keyword_training.get("entries") or []), *(keyword_training.get("dictionaryEvidenceEntries") or [])]
                if isinstance(entry, dict) and str(entry.get("term") or "").strip()
            ]
        )
        sample_source = videos if videos else discovery_context_videos if discovery_context_videos else discovered_videos
        return {
            "discoveredVideos": len(discovered_videos),
            "discoveryContextVideos": len(discovery_context_videos),
            "scannedVideos": len(videos),
            "commentsCollected": len(comments),
            "trainingTextChars": len(str(training_text or "")),
            "targetExistingTerms": target_existing_terms or [],
            "targetTextHits": self.target_text_hits_for_diagnostics(training_text, target_existing_terms or []),
            "acceptedTerms": accepted_terms,
            "evidenceRejected": _number_value(keyword_training.get("evidenceRejected"), 0),
            "sampleVideos": self.sample_videos_for_diagnostics(sample_source),
        }


class VideoContextSummary:
    """Shape video context output into the JS/Python comparator contract."""

    RESULT_KEYS = ("videoContextText", "videoObjectEvidenceText", "contextSourceUrls")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        summary = {key: result.get(key) for key in self.RESULT_KEYS if key in result}
        diagnostics = result.get("diagnostics") if isinstance(result.get("diagnostics"), dict) else None
        if diagnostics is not None:
            summary["diagnostics"] = diagnostics
        return summary


class VideoContextRunner:
    """Build video context/evidence text and diagnostics from a JSON contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = VideoContextBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        return self.builder.build_from_payload(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)


class VideoContextContractComparator:
    """Compare Python video context output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoContextSummary()

    def compare(self) -> dict[str, Any]:
        python_result = VideoContextRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = self._top_level_mismatches(python_result, js_result)
        mismatches.extend(self._diagnostic_mismatches(python_result, js_result))
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _top_level_mismatches(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]

    def _diagnostic_mismatches(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> list[dict[str, Any]]:
        python_diagnostics = python_result.get("diagnostics") if isinstance(python_result.get("diagnostics"), dict) else {}
        js_diagnostics = js_result.get("diagnostics") if isinstance(js_result.get("diagnostics"), dict) else {}
        return [
            {"key": f"diagnostics.{key}", "python": python_diagnostics.get(key), "js": js_value}
            for key, js_value in js_diagnostics.items()
            if python_diagnostics.get(key) != js_value
        ]
