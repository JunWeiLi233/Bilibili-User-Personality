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
