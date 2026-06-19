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
