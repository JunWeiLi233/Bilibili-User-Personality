from __future__ import annotations

import re
import unicodedata
from typing import Any


def _clean_search_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE).lower()


class VideoCommentFilter:
    """Pre-filter Bilibili comments by normalized dictionary needles."""

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
