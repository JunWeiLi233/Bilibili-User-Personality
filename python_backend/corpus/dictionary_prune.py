from __future__ import annotations

import re
import unicodedata
from typing import Any


SUPPORTED_FAMILIES = ("attack", "absolutes", "evidence", "evasion", "cooperation", "correction")
ALLOWED_ASCII_KEYWORD_TERMS = {"giegie", "lsp", "nb", "nt", "pua", "wdnmd", "xswl", "yygq", "yyds"}
URL_HOST_FRAGMENT_TERMS = {"http", "https", "www", "com", "cn", "net", "org", "gov", "mps"}
FAMILY_ALIASES = {
    "sarcasm": "attack",
    "meme": "cooperation",
    "insult": "attack",
    "stanceAttack": "attack",
    "evidenceShift": "evasion",
    "proofShift": "evasion",
    "dodge": "evasion",
    "absolute": "absolutes",
    "overgeneralization": "absolutes",
    "source": "evidence",
    "proof": "evidence",
    "collaborate": "cooperation",
    "hedge": "cooperation",
    "revision": "correction",
}


class DictionaryPrunePlanner:
    """Plan JS-compatible dictionary canonicalization without writing shards."""

    def build(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        before_entries = list(entries or [])
        normalized_entries = self._normalize_entries(before_entries)
        kept_terms = [str(entry.get("term") or "") for entry in normalized_entries]
        kept_set = set(kept_terms)
        removed_terms = [
            str(entry.get("term") or "").strip()
            for entry in before_entries
            if str(entry.get("term") or "").strip() and self.clean_keyword_term(entry.get("term")) not in kept_set
        ]
        before_ascii = self._ascii_count([str(entry.get("term") or "") for entry in before_entries])
        after_ascii = self._ascii_count(kept_terms)
        return {
            "entries": {
                "before": len(before_entries),
                "after": len(normalized_entries),
                "removed": max(0, len(before_entries) - len(normalized_entries)),
            },
            "asciiTerms": {
                "before": before_ascii,
                "after": after_ascii,
                "removed": max(0, before_ascii - after_ascii),
            },
            "removedTerms": sorted(set(removed_terms)),
            "keptTerms": kept_terms,
            "summary": {
                "totalEntries": len(before_entries),
                "asciiEntries": before_ascii,
                "afterEntries": len(normalized_entries),
                "afterAsciiEntries": after_ascii,
            },
        }

    def clean_keyword_term(self, value: Any) -> str:
        if self._looks_like_mojibake_chinese(value):
            return ""
        cleaned = self.clean_term(value)
        cleaned = re.sub(r"[A-Za-z0-9]+", lambda match: match.group(0).lower(), cleaned)
        if any(self._is_han(char) for char in cleaned) and cleaned.lower().endswith("doge") and len(cleaned) > len("doge") + 1:
            cleaned = cleaned[:-4]
        return cleaned.strip()

    def clean_term(self, value: Any) -> str:
        normalized = unicodedata.normalize("NFKC", str(value or ""))
        return "".join(char for char in normalized if char.isalnum() or self._is_han(char)).strip()

    def _normalize_entries(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_term: dict[str, dict[str, Any]] = {}
        for item in entries:
            family = self._normalize_family(item.get("family"))
            meaning = str(item.get("meaning") or item.get("reason") or "").strip()
            if not meaning:
                continue
            terms = [self.clean_keyword_term(item.get("term"))]
            terms.extend(self.clean_keyword_term(value) for value in item.get("variants", []) if isinstance(item.get("variants"), list))
            for term in sorted(set(term for term in terms if 2 <= len(term) <= 12)):
                if self._is_noisy_term(term):
                    continue
                by_term[term] = {
                    "term": term,
                    "family": family,
                    "meaning": meaning,
                }
        return sorted(by_term.values(), key=lambda entry: (entry["family"], entry["term"]))

    def _normalize_family(self, family: Any) -> str:
        raw = str(family or "").strip()
        if raw in SUPPORTED_FAMILIES:
            return raw
        return FAMILY_ALIASES.get(raw, "attack")

    def _is_noisy_term(self, term: str) -> bool:
        if not term:
            return True
        lower = term.lower()
        if lower in URL_HOST_FRAGMENT_TERMS:
            return True
        if self._looks_like_mojibake_chinese(term):
            return True
        if re.fullmatch(r"变体\d+|鍙樹綋\d+", term):
            return True
        if re.fullmatch(r"(?:BV[0-9A-Za-z]{8,}|av\d{6,})", term, flags=re.IGNORECASE):
            return True
        if re.fullmatch(r"\d+(?:vip|VIP|会员|浼氬憳)", term):
            return True
        if re.search(r"\d{3,}元|\d{3,}鍏", term) or re.fullmatch(r"最高领\d+元|鏈€楂橀\d+鍏", term):
            return True
        if term.isdigit() or re.fullmatch(r"[A-Za-z]", term):
            return True
        if re.fullmatch(r"[A-Za-z0-9]+", term) and lower not in ALLOWED_ASCII_KEYWORD_TERMS:
            return True
        if re.match(r"^去问(?!百度|谷歌|Google|搜索|老师|客服)", term, flags=re.IGNORECASE):
            return True
        return False

    def _looks_like_mojibake_chinese(self, value: Any) -> bool:
        text = str(value or "").strip()
        if not text or not any(self._is_han(char) for char in text):
            return False
        if re.search(r"[\ue000-\uf8ff\ufffd]", text):
            return True
        if "锟" in text or "絔" in text or "??" in text:
            return True
        marker_chars = {"瀵", "姉", "鐢", "浜", "濂", "惧", "璧", "浔", "闫", "緟"}
        marker_count = sum(1 for char in text if char in marker_chars)
        return marker_count >= 2 and marker_count / max(1, len(text)) >= 0.5

    def _ascii_count(self, terms: list[str]) -> int:
        return sum(1 for term in terms if re.fullmatch(r"[A-Za-z0-9]+", str(term or "")))

    def _is_han(self, char: str) -> bool:
        return "\u4e00" <= char <= "\u9fff"
