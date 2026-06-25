from __future__ import annotations

import os
import re
import unicodedata
from typing import Any


def clean_search_text(value: Any) -> str:
    """Normalize search text by keeping only letters, numbers, and CJK characters."""
    text = str(value or "")
    text = unicodedata.normalize("NFKC", text)
    # Keep only Han (CJK), letter, and number characters
    text = re.sub(r"[^一-鿿\w\d]+", "", text)
    return text.lower()


def comment_matches_needle_set(message: Any, needle_set: set[str] | None) -> bool:
    """Return True if the message contains any needle with length >= 2."""
    if not needle_set or len(needle_set) == 0:
        return False
    clean = clean_search_text(message)
    if not clean:
        return False
    for needle in needle_set:
        if len(needle) >= 2 and needle in clean:
            return True
    return False


def filter_comments_by_dictionary_needles(
    comments: list[dict[str, Any]] | None = None,
    needle_set: set[str] | None = None,
    extra_needles: list[str] | None = None,
) -> dict[str, Any]:
    """Filter comments to only those containing a dictionary needle term.

    Returns dict with keys: comments, needleCount, matched, applied
    """
    comments_list = comments if isinstance(comments, list) else []
    needle_set = set(needle_set) if needle_set else set()

    for extra in (extra_needles or []):
        clean = clean_search_text(extra)
        if len(clean) >= 2:
            needle_set.add(clean)

    if len(needle_set) == 0:
        return {"comments": comments_list, "needleCount": 0, "matched": len(comments_list), "applied": False}

    matched = [c for c in comments_list if comment_matches_needle_set(c.get("message") if isinstance(c, dict) else None, needle_set)]

    if len(matched) == 0:
        return {"comments": comments_list, "needleCount": len(needle_set), "matched": 0, "applied": False}

    return {"comments": matched, "needleCount": len(needle_set), "matched": len(matched), "applied": True}


def video_search_text(video: dict[str, Any] | None) -> str:
    """Combine video title, desc, description, and dynamic fields into search text."""
    if not isinstance(video, dict):
        return ""
    parts = [str(video.get(k) or "") for k in ("title", "desc", "description", "dynamic")]
    return clean_search_text(" ".join(filter(None, parts)))


def relevance_score_for_video(video: dict[str, Any] | None, needles: list[str] | None = None) -> int:
    """Score a video's relevance by counting needle occurrences in its text."""
    text = video_search_text(video)
    if not text:
        return 0
    score = 0
    for needle in (needles or []):
        if not needle or needle not in text:
            continue
        score += min(12, max(1, len(needle)))
    return score


def build_video_context_text(videos: list[dict[str, Any]] | None = None) -> str:
    """Build Bilibili video context text from video title/desc fields."""
    videos_list = videos if isinstance(videos, list) else []
    seen: set[str] = set()
    lines: list[str] = []
    for video in videos_list:
        if not isinstance(video, dict):
            continue
        for key in ("title", "desc", "description"):
            item = str(video.get(key) or "").strip()
            if not item:
                continue
            item = " ".join(item.split())
            if item in seen:
                continue
            seen.add(item)
            lines.append(f"Bilibili video context: {item}")
    return "\n".join(lines)


def unique_by_key(items: list[Any], key_fn: Any = None) -> list[Any]:
    """Deduplicate items by key, keeping first occurrence (mirrors JS uniqueByKey)."""
    if key_fn is None:
        key_fn = lambda x: x
    seen: dict[Any, Any] = {}
    for item in items:
        if not item:
            continue
        k = key_fn(item)
        if k not in seen:
            seen[k] = item
    return list(seen.values())


def target_text_hits_for_diagnostics(
    training_text: str = "",
    target_existing_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Count occurrences of each target term in the training text."""
    haystack = clean_search_text(training_text)
    if not haystack:
        return []
    terms = [str(t or "").strip() for t in (target_existing_terms or [])]
    terms = [t for t in terms if t]
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        needle = clean_search_text(term)
        if not needle or len(needle) < 2:
            continue
        count = haystack.count(needle)
        if count > 0:
            results.append({"term": term, "count": count})
    return results


def video_context_sources(
    videos: list[dict[str, Any]] | None = None,
    discovered_videos: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Deduplicate all videos across scanned + discovered, matching JS videoContextSources."""
    all_videos = [v for v in ((videos or []) + (discovered_videos or [])) if v]
    return unique_by_key(
        all_videos,
        lambda v: f"{v.get('bvid', '') or ''}\n{v.get('sourceUrl', '') or ''}\n{v.get('title', '') or ''}",
    )


def video_context_source_urls(
    videos: list[dict[str, Any]] | None = None,
    discovered_videos: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Return deduplicated source URLs from all scanned + discovered videos."""
    all_videos = [v for v in ((videos or []) + (discovered_videos or [])) if v]
    urls = [str(v.get("sourceUrl", "") or "").strip() for v in all_videos]
    return unique_by_key([u for u in urls if u])


def sample_videos_for_diagnostics(videos: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Return the first 5 videos with bvid, title, and sourceUrl for diagnostics."""
    result: list[dict[str, Any]] = []
    for video in (videos or [])[:5]:
        if not isinstance(video, dict):
            continue
        result.append({
            "bvid": str(video.get("bvid", "") or "").strip(),
            "title": " ".join(str(video.get("title", "") or "").split()).strip()[:120],
            "sourceUrl": str(video.get("sourceUrl", "") or "").strip(),
        })
    return result


# — Private helpers for searchNeedlesForRelevance —

def _parse_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item or "").strip() for item in value if str(item or "").strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _search_query_needles(query: Any) -> list[str]:
    raw = str(query or "").strip()
    if not raw:
        return []
    tokens = raw.split()
    return [clean_search_text(t) for t in [raw] + tokens if len(clean_search_text(t)) >= 2]


_GENERIC_TARGET_SEARCH_NEEDLES = {
    clean_search_text(t) for t in [
        "b站", "bilibili", "视频", "投稿", "合集", "全集", "完整版", "免费观看",
        "评论", "评论区", "弹幕", "热评", "回复", "互动", "讨论", "争议", "热点",
        "热门", "梗图", "名场面", "切片", "盘点", "复盘", "链接", "自取", "出处",
        "来源", "是什么梗", "什么意思",
    ]
}

_AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES = {clean_search_text(t) for t in ["问百度", "问百度有什么用"]}


def _is_generic_target_search_needle(needle: Any) -> bool:
    return clean_search_text(needle) in _GENERIC_TARGET_SEARCH_NEEDLES


# — Exported functions (3 to satisfy the goal) —

def search_needles_for_relevance(
    search_queries: list[str] | None = None,
    target_existing_terms: list[str] | None = None,
) -> list[str]:
    """Build a priority-ordered list of search needles for relevance scoring."""
    target_needles = unique_by_key(
        [clean_search_text(t) for t in (target_existing_terms or []) if len(clean_search_text(t)) >= 2],
    )
    raw_query_needles: list[str] = []
    for query in (search_queries or []):
        for item in _parse_list(query):
            raw_query_needles.extend(_search_query_needles(item))
    query_needles = [
        n for n in raw_query_needles if len(target_needles) == 0 or not _is_generic_target_search_needle(n)
    ]
    unique_query_needles = unique_by_key([n for n in query_needles if len(n) >= 2])
    if len(target_needles) == 0:
        return unique_query_needles
    query_needle_set = set(unique_query_needles)
    target_in_query = any(n in query_needle_set for n in target_needles)
    alias_query_needles = [n for n in unique_query_needles if n not in target_needles]
    if len(alias_query_needles) > 0 and not target_in_query:
        if any(n in _AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES for n in target_needles):
            return alias_query_needles + alias_query_needles + unique_query_needles
        return alias_query_needles + alias_query_needles + target_needles + unique_query_needles
    return target_needles + target_needles + unique_query_needles


def sort_videos_by_relevance(
    videos: list[dict[str, Any]] | None = None,
    search_queries: list[str] | None = None,
    target_existing_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Sort videos by relevance score, keeping original order for ties."""
    needles = search_needles_for_relevance(search_queries, target_existing_terms)
    if len(needles) == 0:
        return list(videos or [])
    scored = [(i, v, relevance_score_for_video(v, needles)) for i, v in enumerate(videos or []) if isinstance(v, dict)]
    scored.sort(key=lambda x: (-x[2], x[0]))
    return [item[1] for item in scored]


def build_target_video_object_evidence_text(
    videos: list[dict[str, Any]] | None = None,
    search_queries: list[str] | None = None,
    target_existing_terms: list[str] | None = None,
) -> str:
    """Build Bilibili public video title text for target term evidence."""
    if not target_existing_terms:
        return ""
    needles = search_needles_for_relevance(search_queries, target_existing_terms)
    if len(needles) == 0:
        return ""
    lines: list[str] = []
    seen: set[str] = set()
    for video in (videos or []):
        if not isinstance(video, dict):
            continue
        for key in ("title", "desc", "description"):
            item = " ".join(str(video.get(key) or "").split()).strip()
            if not item:
                continue
            if any(n in item for n in needles):
                if item not in seen:
                    seen.add(item)
                    lines.append(f"Bilibili public video title: {item}")
    return "\n".join(lines)


def build_collection_diagnostics(
    discovered_videos: list[dict[str, Any]] | None = None,
    discovery_context_videos: list[dict[str, Any]] | None = None,
    videos: list[dict[str, Any]] | None = None,
    comments: list[dict[str, Any]] | None = None,
    training_text: str = "",
    target_existing_terms: list[str] | None = None,
    keyword_training: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build collection diagnostics matching JS buildCollectionDiagnostics."""
    dv = discovered_videos or []
    dcv = discovery_context_videos or []
    vids = videos or []
    cmts = comments or []
    kwt = keyword_training or {}
    return {
        "discoveredVideos": len(dv),
        "discoveryContextVideos": len(dcv),
        "scannedVideos": len(vids),
        "commentsCollected": len(cmts),
        "trainingTextChars": len(str(training_text or "")),
        "targetExistingTerms": target_existing_terms,
        "targetTextHits": target_text_hits_for_diagnostics(training_text, target_existing_terms),
        "acceptedTerms": unique_by_key(
            [str(e.get("term", "") or "").strip() for e in (kwt.get("entries") or []) + (kwt.get("dictionaryEvidenceEntries") or []) if str(e.get("term", "") or "").strip()]
        ),
        "evidenceRejected": max(0, int(kwt.get("evidenceRejected") or 0)),
        "sampleVideos": sample_videos_for_diagnostics(vids if vids else dcv if dcv else dv),
    }


# — Private helpers for filterRelevantVideos —

_STRICT_TARGET_RELEVANCE_NEEDLES = {clean_search_text(t) for t in [
    "国际宅男联盟", "宅男联盟", "果蝇play", "不一一", "不一一评价",
    "就不一一评价了", "怕被删评", "怕被删评故发图", "单车变摩托",
    "第一次就看懂了", "鼻子占领大脑", "并非偶遇",
]}

_ASK_BAIDU_PRODUCT_NOISE_NEEDLES = [clean_search_text(t) for t in [
    "百度文库", "百度网盘", "百度云", "百度APP", "百度地图",
    "百度百科", "百度贴吧", "百度翻译", "百度输入法", "百度公关",
    "公关一号位", "问百度陈睿", "陈睿演唱",
]]


def _targets_ask_baidu_term(target_existing_terms: list[str] | None = None) -> bool:
    return any(clean_search_text(t) in _AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES for t in (target_existing_terms or []))


def _targets_require_strict_relevance(target_existing_terms: list[str] | None = None) -> bool:
    return any(clean_search_text(t) in _STRICT_TARGET_RELEVANCE_NEEDLES for t in (target_existing_terms or []))


def _is_ask_baidu_product_noise_video(video: dict[str, Any] | None) -> bool:
    text = video_search_text(video)
    return bool(text and any(n in text for n in _ASK_BAIDU_PRODUCT_NOISE_NEEDLES))


def _mixed_script_ascii_anchors(value: Any) -> list[str]:
    text = clean_search_text(value)
    if not re.search(r"[一-鿿]", text):
        return []
    return [m.group(0).lower() for m in re.finditer(r"[a-z0-9]{2,}", text, re.IGNORECASE)]


def _required_ascii_anchors_for_search(search_queries: list[str] | None = None) -> list[str]:
    items: list[str] = []
    for query in (search_queries or []):
        for parsed in _parse_list(query):
            items.extend(str(parsed or "").split())
    filtered = [i for i in items if i and not _is_generic_target_search_needle(i)]
    anchors: list[str] = []
    for item in filtered:
        anchors.extend(_mixed_script_ascii_anchors(item))
    return unique_by_key(anchors)


def _strict_target_relevance_score_for_video(video: dict[str, Any] | None, target_existing_terms: list[str] | None = None) -> int:
    needles = unique_by_key([clean_search_text(t) for t in (target_existing_terms or []) if len(clean_search_text(t)) >= 2])
    return relevance_score_for_video(video, needles)


def filter_relevant_videos(
    videos: list[dict[str, Any]] | None = None,
    search_queries: list[str] | None = None,
    target_existing_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Filter videos to only those relevant to search queries and target terms."""
    needles = search_needles_for_relevance(search_queries, target_existing_terms)
    if len(needles) == 0:
        return list(videos or [])
    reject_baidu_noise = _targets_ask_baidu_term(target_existing_terms)
    require_strict = _targets_require_strict_relevance(target_existing_terms)
    required_anchors = _required_ascii_anchors_for_search(search_queries)
    result: list[dict[str, Any]] = []
    for video in (videos or []):
        if not isinstance(video, dict):
            continue
        if reject_baidu_noise and _is_ask_baidu_product_noise_video(video):
            continue
        text = video_search_text(video)
        if required_anchors and not any(a in text for a in required_anchors):
            continue
        if require_strict:
            if _strict_target_relevance_score_for_video(video, target_existing_terms) > 0:
                result.append(video)
        elif relevance_score_for_video(video, needles) > 0:
            result.append(video)
    return result


# JS-compatible default constants (port of videoKeywordSearch.js exports)

DEFAULT_VIDEO_LINK = os.environ.get(
    "BILIBILI_DEFAULT_VIDEO_LINKS",
    os.environ.get("BILIBILI_DEFAULT_VIDEO_LINK", ""),
)

DEFAULT_VIDEO_SEARCH_QUERY = os.environ.get(
    "BILIBILI_VIDEO_SEARCH_QUERIES",
    os.environ.get("BILIBILI_VIDEO_SEARCH_QUERY", "中文互联网 阴阳怪气"),
)

DEFAULT_CONTROVERSY_SEARCH_QUERIES = (
    os.environ.get("BILIBILI_CONTROVERSY_SEARCH_QUERIES") or ""
) or [
    "时政 热评 评论区",
    "国际政治 热评 评论区",
    "国际关系 中美 热评",
    "游戏 节奏 热评",
    "游戏厂商 节奏 热评",
    "社会事件 争议 热评",
    "原神 争议 评论区",
    "原神 节奏 热评",
    "米哈游 节奏 热评",
    "黑神话 争议",
    "KPL 王者荣耀 争议 评论区",
    "王者荣耀 节奏",
    "明日方舟 节奏",
    "男女对立 评论区",
    "女权 评论区",
    "女权 争议 热评",
    "彩礼 评论区",
    "就业 学历 争议",
    "饭圈 争议",
    "影视 争议 热评",
    "历史争议 评论区",
    "科技公司 争议",
    "新能源车 争议 热评",
    "小米汽车 特斯拉 评论区",
    "SpaceX 争议 评论区",
    "SpaceX 星舰 评论区",
    "AI 争议 评论区",
    "辟谣 数据 证据 评论区",
    "科普 证据 来源 热评",
    "俄乌 评论区",
    "俄乌 争议 热评",
    "旺座 争议 评论区",
    "张雪峰 争议 评论区",
    "盘盘 评论区",
    "北欧tv 评论区",
    "老广tv 评论区",
    "485 评论区",
    "数据 真假 争议 评论",
    "论证 反驳 评论区",
    "修正 道歉 更正 评论",
    "发链接 贴原文 评论",
    "绝对化 全称判断 评论",
    "不会百度 自己搜 评论区",
]

DEFAULT_CONTROVERSIAL_POPULAR_SEARCH_ORDER = os.environ.get(
    "BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER", "click"
)

def _bounded_int(env_value: str | None, default: int, minimum: int, maximum: int) -> int:
    if env_value is None:
        return default
    try:
        return max(minimum, min(int(env_value), maximum))
    except (TypeError, ValueError):
        return default


DEFAULT_CONTROVERSIAL_POPULAR_QUERY_LIMIT = _bounded_int(
    os.environ.get("BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT"), 4, 0, 20
)

DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = os.environ.get(
    "BILIBILI_HISTORY_TAG_CORPUS_PATH", ""
)


# — Additional pure helpers ported from videoKeywordSearch.js —

def parse_set(value: Any) -> set[str]:
    """Parse a value into a set of strings (mirrors JS parseSet)."""
    return set(_parse_list(value))


def env_flag(value: Any, fallback: bool = False) -> bool:
    """Parse an environment variable as a boolean flag (mirrors JS envFlag)."""
    if value is None or value == "":
        return fallback
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def round_robin_unique(
    groups: list[list[dict[str, Any]]],
    limit: int,
    key_fn: Any = None,
) -> list[dict[str, Any]]:
    """Interleave items from groups round-robin, deduplicating by key (mirrors JS roundRobinUnique)."""
    if key_fn is None:
        key_fn = lambda x: x.get("bvid", "") or x.get("sourceUrl", "") or x.get("title", "")
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    buckets = [[item for item in group if item] for group in groups]
    max_len = max((len(b) for b in buckets), default=0)
    for index in range(max_len):
        if len(results) >= limit:
            break
        for bucket in buckets:
            if index >= len(bucket):
                continue
            item = bucket[index]
            key = key_fn(item)
            if not key or key in seen:
                continue
            seen.add(key)
            results.append(item)
            if len(results) >= limit:
                break
    return results


def is_blocked_discovery_warning(warning: Any) -> bool:
    """Check if a warning string indicates an HTTP block (mirrors JS isBlockedDiscoveryWarning)."""
    return bool(re.search(r"\bHTTP\s+(?:403|412|429)\b", str(warning or ""), re.IGNORECASE))


def discovery_queries_for_search(
    search_queries: list[str] | None = None,
    target_existing_terms: list[str] | None = None,
) -> list[str]:
    """Refine search queries by stripping generic tokens when targets are present (mirrors JS discoveryQueriesForSearch)."""
    terms = target_existing_terms or []
    if len(terms) == 0:
        return list(search_queries or [])
    results: list[str] = []
    for query in (search_queries or []):
        clean = str(query or "").strip()
        tokens = clean.split()
        focused_tokens = [t for t in tokens if t and not _is_generic_target_search_needle(t)]
        focused = " ".join(focused_tokens).strip()
        results.append(focused or clean)
    return unique_by_key([r for r in results if r])


def dictionary_entry_needles(entry: dict[str, Any] | None = None) -> list[str]:
    """Extract search needles from a dictionary entry (mirrors JS dictionaryEntryNeedles)."""
    if not isinstance(entry, dict):
        return []
    raw = [entry.get("term")]
    raw.extend(entry.get("aliases") if isinstance(entry.get("aliases"), list) else [])
    raw.extend(entry.get("examples") if isinstance(entry.get("examples"), list) else [])
    return unique_by_key([
        clean_search_text(item) for item in raw if len(clean_search_text(item)) >= 2
    ])


def dictionary_needle_set(dictionary: dict[str, Any] | None = None) -> set[str]:
    """Build a set of all search needles from a keyword dictionary (mirrors JS dictionaryNeedleSet)."""
    result: set[str] = set()
    for entry in (dictionary or {}).get("entries") or []:
        for needle in dictionary_entry_needles(entry):
            result.add(needle)
    return result


def target_evidence_count(entry: dict[str, Any] | None = None) -> int:
    """Extract evidence count from a dictionary entry (mirrors JS targetEvidenceCount)."""
    if not isinstance(entry, dict):
        return 0
    numeric = entry.get("evidenceCount", entry.get("coverageEvidenceCount"))
    if numeric is None and isinstance(entry.get("evidence"), list):
        numeric = len(entry["evidence"])
    try:
        return max(0, int(numeric or 0))
    except (TypeError, ValueError):
        return 0


# — Configuration resolution (pure part of JS searchVideoKeywords) —


def resolve_search_video_keywords_config(
    payload: dict[str, Any] | None = None,
    deps: dict[str, Any] | None = None,
    env: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve all configuration for searchVideoKeywords from payload, deps, and env.

    This is the pure computation that happens before any async network calls
    in the JS searchVideoKeywords function. It maps 1:1 with lines 614–772
    of server/services/videoKeywordSearch.js.
    """
    p = payload if isinstance(payload, dict) else {}
    d = deps if isinstance(deps, dict) else {}
    e = env if isinstance(env, dict) else {}

    video_links = _parse_list(
        p.get("videoLinks") or p.get("videoLink") or p.get("urls") or p.get("url")
        or p.get("bvids") or p.get("bvid")
        or d.get("defaultVideoLinks") or d.get("defaultVideoLink")
        or DEFAULT_VIDEO_LINK
    )

    favorite_raw = str(p.get("favoriteId") or p.get("favoriteLink") or p.get("favorite") or p.get("favId") or "")

    search_queries = _parse_list(
        p.get("searchQueries") or p.get("searchQuery") or p.get("query")
        or d.get("defaultSearchQueries") or d.get("defaultSearchQuery")
        or DEFAULT_VIDEO_SEARCH_QUERY
    )

    controversy_queries = _parse_list(
        p.get("controversyQueries") or p.get("controversyQuery")
        or d.get("defaultControversyQueries") or d.get("defaultControversyQuery")
        or DEFAULT_CONTROVERSY_SEARCH_QUERIES
    )

    target_existing_terms = _parse_list(
        p.get("targetExistingTerms") or p.get("targetExistingTerm")
        or p.get("targetTerms") or p.get("targetTerm")
        or d.get("targetExistingTerms") or d.get("targetExistingTerm")
        or d.get("targetTerms") or d.get("targetTerm")
    )

    discovery_search_queries = discovery_queries_for_search(search_queries, target_existing_terms)

    discovery_limit = max(1, min(
        int(p.get("discoveryLimit") or d.get("discoveryLimit")
            or e.get("BILIBILI_VIDEO_DISCOVERY_LIMIT") or 6),
        20,
    ))

    discovery_pages = max(1, min(
        int(p.get("discoveryPages") or d.get("discoveryPages")
            or e.get("BILIBILI_VIDEO_DISCOVERY_PAGES") or 1),
        5,
    ))

    controversial_popular_query_limit = _bounded_int(
        p.get("controversialPopularQueryLimit") if "controversialPopularQueryLimit" in p
        else d.get("controversialPopularQueryLimit") if "controversialPopularQueryLimit" in d
        else e.get("BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT"),
        DEFAULT_CONTROVERSIAL_POPULAR_QUERY_LIMIT,
        0,
        20,
    )

    controversial_popular_search_order = str(
        p.get("controversialPopularSearchOrder")
        or d.get("controversialPopularSearchOrder")
        or e.get("BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER")
        or DEFAULT_CONTROVERSIAL_POPULAR_SEARCH_ORDER
    ).strip().lower()

    existing_terms_only = (
        p.get("existingTermsOnly") is True
        or p.get("existingDictionaryTermsOnly") is True
        or d.get("existingTermsOnly") is True
        or e.get("BILIBILI_HARVEST_EXISTING_TERMS_ONLY") == "1"
    )

    discovery_candidate_limit = discovery_limit
    if existing_terms_only or len(target_existing_terms) > 0:
        discovery_candidate_limit = max(
            discovery_limit,
            min(
                int(p.get("discoveryCandidateLimit") if "discoveryCandidateLimit" in p
                    else d.get("discoveryCandidateLimit") if "discoveryCandidateLimit" in d
                    else e.get("BILIBILI_VIDEO_DISCOVERY_CANDIDATE_LIMIT") or 10),
                50,
            ),
        )

    include_video_context = (
        False if p.get("includeVideoContext") is False
        else p.get("includeVideoContext") is True
        or d.get("includeVideoContext") is True
        or e.get("BILIBILI_HARVEST_INCLUDE_VIDEO_CONTEXT") == "1"
        or existing_terms_only
    )

    include_video_object_evidence = (
        p.get("includeVideoObjectEvidence") is not False
        and d.get("includeVideoObjectEvidence") is not False
    )

    include_danmaku = (
        False if p.get("includeDanmaku") is False
        else p.get("includeDanmaku") is True
        or d.get("includeDanmaku") is True
        or (
            e.get("BILIBILI_HARVEST_INCLUDE_DANMAKU") == "1"
            and (bool(d.get("fetchText")) or p.get("allowNetworkDanmaku") is True or d.get("allowNetworkDanmaku") is True)
        )
    )

    discovery_mode = str(
        p.get("discoveryMode") or d.get("discoveryMode")
        or e.get("BILIBILI_VIDEO_DISCOVERY_MODE") or "controversial"
    ).strip().lower()

    prioritize_search_queries = (
        p.get("prioritizeSearchQueries") is True
        or d.get("prioritizeSearchQueries") is True
        or e.get("BILIBILI_HARVEST_PRIORITIZE_SEARCH_QUERIES") == "1"
        or (existing_terms_only and discovery_mode != "controversial")
    )

    include_generic_popular = (
        p.get("includeGenericPopular") is True
        or d.get("includeGenericPopular") is True
        or env_flag(e.get("BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR"), False)
    )

    target_search_only = p.get("targetSearchOnly") is True or d.get("targetSearchOnly") is True
    allow_filtered_discovery_fallback = p.get("allowFilteredDiscoveryFallback") is True or d.get("allowFilteredDiscoveryFallback") is True
    prefer_filtered_discovery_fallback = p.get("preferFilteredDiscoveryFallback") is True or d.get("preferFilteredDiscoveryFallback") is True
    allow_popular_discovery_on_search_block = p.get("allowPopularDiscoveryOnSearchBlock") is True or d.get("allowPopularDiscoveryOnSearchBlock") is True

    include_history_tags = (
        p.get("includeHistoryTags") is True
        or d.get("includeHistoryTags") is True
        or e.get("BILIBILI_HARVEST_INCLUDE_HISTORY_TAGS") == "1"
    )

    history_tag_video_limit = max(
        discovery_limit,
        min(
            int(p.get("historyTagVideoLimit") if "historyTagVideoLimit" in p
                else d.get("historyTagVideoLimit") if "historyTagVideoLimit" in d
                else e.get("BILIBILI_HISTORY_TAG_VIDEO_LIMIT") or max(20, discovery_limit)),
            100,
        ),
    )

    history_tag_corpus_path = (
        p.get("historyTagCorpusPath")
        or d.get("historyTagCorpusPath")
        or e.get("BILIBILI_HISTORY_TAG_CORPUS_PATH")
        or DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH
    )

    evidence_source_video_fallback = (
        p.get("evidenceSourceVideoFallback") is True
        or p.get("allowEvidenceSourceVideoFallback") is True
        or d.get("evidenceSourceVideoFallback") is True
        or d.get("allowEvidenceSourceVideoFallback") is True
    )

    evidence_source_fallback_limit = max(
        discovery_limit,
        min(
            int(p.get("evidenceSourceFallbackLimit") if "evidenceSourceFallbackLimit" in p
                else d.get("evidenceSourceFallbackLimit") if "evidenceSourceFallbackLimit" in d
                else e.get("BILIBILI_EVIDENCE_SOURCE_FALLBACK_LIMIT") or max(12, discovery_limit)),
            50,
        ),
    )

    evidence_source_fallback_pages = max(1, min(
        int(p.get("evidenceSourceFallbackPages") if "evidenceSourceFallbackPages" in p
            else d.get("evidenceSourceFallbackPages") if "evidenceSourceFallbackPages" in d
            else e.get("BILIBILI_EVIDENCE_SOURCE_FALLBACK_PAGES") or 3),
        5,
    ))

    exclude_bvids = parse_set(p.get("excludeBvids") or d.get("excludeBvids"))
    popular_fallback_exclude_bvids = parse_set(p.get("popularFallbackExcludeBvids") or d.get("popularFallbackExcludeBvids"))

    return {
        "videoLinks": video_links,
        "favoriteRaw": favorite_raw,
        "searchQueries": search_queries,
        "controversyQueries": controversy_queries,
        "targetExistingTerms": target_existing_terms,
        "discoverySearchQueries": discovery_search_queries,
        "discoveryLimit": discovery_limit,
        "discoveryPages": discovery_pages,
        "controversialPopularQueryLimit": controversial_popular_query_limit,
        "controversialPopularSearchOrder": controversial_popular_search_order,
        "existingTermsOnly": existing_terms_only,
        "discoveryCandidateLimit": discovery_candidate_limit,
        "includeVideoContext": include_video_context,
        "includeVideoObjectEvidence": include_video_object_evidence,
        "includeDanmaku": include_danmaku,
        "discoveryMode": discovery_mode,
        "prioritizeSearchQueries": prioritize_search_queries,
        "includeGenericPopular": include_generic_popular,
        "targetSearchOnly": target_search_only,
        "allowFilteredDiscoveryFallback": allow_filtered_discovery_fallback,
        "preferFilteredDiscoveryFallback": prefer_filtered_discovery_fallback,
        "allowPopularDiscoveryOnSearchBlock": allow_popular_discovery_on_search_block,
        "includeHistoryTags": include_history_tags,
        "historyTagVideoLimit": history_tag_video_limit,
        "historyTagCorpusPath": history_tag_corpus_path,
        "evidenceSourceVideoFallback": evidence_source_video_fallback,
        "evidenceSourceFallbackLimit": evidence_source_fallback_limit,
        "evidenceSourceFallbackPages": evidence_source_fallback_pages,
        "excludeBvids": exclude_bvids,
        "popularFallbackExcludeBvids": popular_fallback_exclude_bvids,
    }
