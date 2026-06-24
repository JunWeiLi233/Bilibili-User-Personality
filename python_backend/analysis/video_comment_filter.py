from __future__ import annotations

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
