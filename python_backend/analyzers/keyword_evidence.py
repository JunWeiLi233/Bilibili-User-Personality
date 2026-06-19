from __future__ import annotations

import re
from typing import Any


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _clean_keyword_term(value: Any) -> str:
    return _clean_text(value).lower()


def _clean_evidence_text(value: Any) -> str:
    return _clean_text(value).lower()


def _unique(items: list[Any]) -> list[Any]:
    seen: set[str] = set()
    result: list[Any] = []
    for item in items:
        key = str(item)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


TERM_EVIDENCE_ALIASES = {
    "问百度": ["不会百度", "自己百度", "你不会百度吗", "不会自己百度吗"],
    "问百度有什么用": ["不会百度", "自己百度", "你不会百度吗", "问百度"],
    "猪鼻": ["猪逼", "猪比", "猪币"],
    "自己查": ["自己搜", "你自己搜", "自己查去"],
    "自己查去": ["自己查", "自己搜"],
    "自己搜": ["自己查"],
    "出处": ["求出处", "有出处吗", "原文出处", "出处呢", "发出处"],
}


class KeywordEvidenceMatcher:
    """Match DeepSeek keyword entries against direct source text evidence."""

    def evidence_needles_for_term(self, term: Any) -> list[str]:
        clean = _clean_keyword_term(term)
        if not clean:
            return []
        aliases = TERM_EVIDENCE_ALIASES.get(_clean_text(term), []) + TERM_EVIDENCE_ALIASES.get(clean, [])
        return _unique([clean, *[_clean_evidence_text(alias) for alias in aliases]])

    def filter_entries_by_evidence(
        self,
        entries: list[dict[str, Any]] | None = None,
        text: Any = "",
        *,
        source: Any = "",
        uid: Any = "",
    ) -> list[dict[str, Any]]:
        if not _clean_evidence_text(text):
            return []
        matched: list[dict[str, Any]] = []
        for raw_entry in entries if isinstance(entries, list) else []:
            entry = self._normalize_entry(raw_entry)
            if not entry.get("term"):
                continue
            evidence = self.evidence_for_term(entry["term"], text, family=entry.get("family", ""), source=source, uid=uid)
            if evidence["evidenceCount"] <= 0:
                continue
            matched.append({**entry, **evidence})
        return matched

    def find_dictionary_entries_with_text_evidence(
        self,
        dictionary: dict[str, Any] | None = None,
        text: Any = "",
        *,
        source: Any = "",
        uid: Any = "",
        exclude_terms: list[Any] | set[Any] | tuple[Any, ...] | None = None,
    ) -> list[dict[str, Any]]:
        exclude = {_clean_keyword_term(term) for term in exclude_terms or [] if _clean_keyword_term(term)}
        entries = [
            entry
            for entry in (dictionary.get("entries") if isinstance(dictionary, dict) and isinstance(dictionary.get("entries"), list) else [])
            if _clean_keyword_term(entry.get("term") if isinstance(entry, dict) else "") not in exclude
        ]
        return self.filter_entries_by_evidence(entries, text, source=source, uid=uid)

    def evidence_for_term(self, term: Any, text: Any, *, family: Any = "", source: Any = "", uid: Any = "") -> dict[str, Any]:
        needles = self.evidence_needles_for_term(term)
        evidence_count = 0
        samples: list[str] = []
        sources: list[dict[str, str]] = []
        source_text = str(source or "").strip()
        uid_text = str(uid or "").strip()
        for line in str(text or "").splitlines():
            clean_line = _clean_evidence_text(line)
            if not any(needle in clean_line for needle in needles):
                continue
            sample = _clean_text(line)
            if not sample:
                continue
            evidence_count += self._count_non_overlapping_needles(clean_line, needles)
            if len(samples) < 3:
                clipped = f"{sample[:120]}..." if len(sample) > 120 else sample
                samples.append(clipped)
                if source_text or uid_text:
                    sources.append({"source": source_text, "uid": uid_text, "sample": clipped})
        return {
            "evidenceCount": evidence_count,
            "evidenceSamples": _unique(samples)[:3],
            "evidenceSources": self._normalize_evidence_sources(sources)[:3],
        }

    def _normalize_entry(self, entry: dict[str, Any] | Any) -> dict[str, Any]:
        entry = entry if isinstance(entry, dict) else {}
        term = _clean_keyword_term(entry.get("term") or entry.get("keyword") or entry.get("text"))
        return {
            **entry,
            "term": term,
            "family": _clean_text(entry.get("family") or "attack"),
            "meaning": _clean_text(entry.get("meaning")),
        }

    def _count_non_overlapping_needles(self, haystack: str, needles: list[str]) -> int:
        remaining = str(haystack or "")
        count = 0
        for needle in sorted([needle for needle in needles if needle], key=len, reverse=True):
            index = 0
            while index <= len(remaining):
                found = remaining.find(needle, index)
                if found == -1:
                    break
                count += 1
                remaining = f"{remaining[:found]}{' ' * len(needle)}{remaining[found + len(needle):]}"
                index = found + len(needle)
        return count

    def _normalize_evidence_sources(self, sources: list[dict[str, str]]) -> list[dict[str, str]]:
        seen: set[tuple[str, str, str]] = set()
        normalized: list[dict[str, str]] = []
        for source in sources:
            item = {
                "source": _clean_text(source.get("source")),
                "uid": _clean_text(source.get("uid")),
                "sample": _clean_text(source.get("sample")),
            }
            key = (item["source"], item["uid"], item["sample"])
            if not item["sample"] or key in seen:
                continue
            seen.add(key)
            normalized.append(item)
        return normalized
