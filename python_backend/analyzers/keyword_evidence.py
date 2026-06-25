from __future__ import annotations

import argparse
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.dictionary_prune import FAMILY_ALIASES, SUPPORTED_FAMILIES
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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


class KeywordEvidenceSummary:
    """Shape keyword evidence results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("ok", "mode", "count", "entries")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class KeywordEvidenceContractComparator:
    """Compare keyword evidence results using the JS/Python JSON contract."""

    def __init__(self, summary: KeywordEvidenceSummary | None = None):
        self.summary = summary or KeywordEvidenceSummary()

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


class KeywordEvidencePayloadRunner:
    """Run keyword evidence matching from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.matcher = KeywordEvidenceMatcher()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        return self.matcher.run_from_payload(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        return JsonContractReader().read_value(path, fallback)


class KeywordEvidencePayloadContractComparator:
    """Compare Python keyword evidence output against a saved JS-compatible report."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = KeywordEvidenceSummary()
        self.comparator = KeywordEvidenceContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = KeywordEvidencePayloadRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


@dataclass(frozen=True)
class KeywordEvidenceRequest:
    """Analyzer-layer request object for keyword evidence JSON contract modes."""

    payload_path: str | Path
    compare_js_report_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return KeywordEvidencePayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return KeywordEvidencePayloadRunner(self.payload_path).run()


class KeywordEvidenceCommandRequest:
    """Parse CLI argv for keyword evidence while keeping request ownership in analyzers."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Match keyword dictionary entries against direct text evidence.")
        parser.add_argument("--payload", required=True, help="JSON payload with entries or dictionary plus text.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible keyword evidence report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return KeywordEvidenceRequest(
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


class KeywordEvidenceMatcher:
    """Match DeepSeek keyword entries against direct source text evidence."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        text = payload.get("text") or ""
        source = payload.get("source") or ""
        uid = payload.get("uid") or ""
        mode = str(payload.get("mode") or "entries").strip().lower()
        if mode == "dictionary":
            dictionary = DictionaryLoader.load_from_payload(self._dictionary_payload(payload))
            entries = self.find_dictionary_entries_with_text_evidence(
                {**dictionary.manifest, "entries": dictionary.entries},
                text,
                source=source,
                uid=uid,
                exclude_terms=payload.get("excludeTerms") if isinstance(payload.get("excludeTerms"), list) else [],
            )
        else:
            entries = self.filter_entries_by_evidence(
                payload.get("entries") if isinstance(payload.get("entries"), list) else [],
                text,
                source=source,
                uid=uid,
            )
            mode = "entries"
        return {"ok": True, "mode": mode, "count": len(entries), "entries": entries}

    def _dictionary_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if isinstance(payload.get("dictionary"), dict) or payload.get("dictionaryPath") or payload.get("path"):
            return payload
        return {"dictionary": {"entries": []}}

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


# — Ported helpers from deepseekKeywordTrainer.js for normalize_keyword_entries —


def _normalize_family(family: Any) -> str:
    raw = str(family or "").strip()
    if raw in SUPPORTED_FAMILIES:
        return raw
    return FAMILY_ALIASES.get(raw, "attack")


def _clean_term(value: Any) -> str:
    text = str(value or "")
    normalized = unicodedata.normalize("NFKC", text)
    cleaned = re.sub(r"[^一-鿿A-Za-z0-9]", "", normalized)
    cleaned = re.sub(r"^\d+(?=百分百$)", "", cleaned)
    cleaned = re.sub(r"(?<=一-鿿)[A-Za-z]$", "", cleaned)
    return cleaned.strip()


def _clean_keyword_term(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if _looks_like_mojibake_chinese(text):
        return ""
    normalized = unicodedata.normalize("NFKC", text)
    cleaned = re.sub(r"[^一-鿿A-Za-z0-9]", "", normalized)
    cleaned = re.sub(r"[A-Za-z0-9]+", lambda m: m.group(0).lower(), cleaned)
    cleaned = re.sub(r"^热词系列", "", cleaned).strip()
    if re.search(r"[一-鿿]", cleaned) and cleaned.lower().endswith("doge") and len(cleaned) > 4:
        cleaned = cleaned[:-4]
    return cleaned.strip()


def _looks_like_mojibake_chinese(term: Any) -> bool:
    text = str(term or "").strip()
    if not text or not re.search(r"[一-鿿]", text):
        return False
    mojibake_prefixes = [
        "锻",
        "鏂",
        "閿",
        "閼",
        "闂",
        "闃",
        "闄",
        "闅",
        "閲",
        "闈",
        "闉",
        "闋",
        "闌",
        "闍",
        "闎",
        "闏",
    ]
    if any(text.startswith(prefix) and len(text) > len(prefix) for prefix in mojibake_prefixes):
        return True
    if re.search(r"[-�]", text):
        return True
    if re.search(r"[�]|\?{2,}", text):
        return True
    chars = list(text)
    marker_chars = {"锟", "斤", "拷", "娴", "铡", "闇", "鍋", "傳", "噹", "鏃", "鍋"}
    marker_count = sum(1 for char in chars if char in marker_chars)
    return marker_count >= 2 and marker_count / len(chars) >= 0.5


def _is_recovered_placeholder_meaning(meaning: Any) -> bool:
    return bool(
        re.search(
            r"Recovered term metadata after an interrupted local dictionary write",
            str(meaning or ""),
            re.IGNORECASE,
        )
    )


def _recovered_meaning_for_term(term: Any, family: Any) -> str:
    clean_term = str(term or "").strip()
    meanings = {
        "attack": (
            f"“{clean_term}”"
            "用于嘲讽、贬低或对某人、"
            "群体、动机、说法作敌意评价"
        ),
        "absolutes": (
            f"“{clean_term}”"
            "用于缺少限定的强断言、"
            "全称化或绝对化表达"
        ),
        "evidence": (
            f"“{clean_term}”"
            "用于请求、补充或指向可核验的"
            "来源、证据或原始材料"
        ),
        "evasion": (
            f"“{clean_term}”"
            "用于暗示、转移解释责任或以"
            "圈内默契代替直接说明"
        ),
        "cooperation": (
            f"“{clean_term}”"
            "用于表示支持、补充、轻松互动"
            "或合作式讨论"
        ),
        "correction": (
            f"“{clean_term}”"
            "用于承认信息不准、修正说法或"
            "降低原先结论强度"
        ),
    }
    return meanings.get(
        str(family or "").strip(),
        f"“{clean_term}”的中文互联网语用义，"
        "需结合完整发言上下文判断",
    )


def _canonical_meaning_for_term(term: Any, family: Any, meaning: Any) -> str:
    if str(term or "").strip() == "软文" and str(family or "").strip() == "evidence":
        return (
            "“软文”"
            "用于质疑内容是付费宣传、"
            "带节奏或影响证据可信度的稿件"
        )
    return str(meaning or "")


def _is_ascii_suffix_fragment_of(fragment: Any, term: Any) -> bool:
    frag = str(fragment or "")
    t = str(term or "")
    return bool(
        re.match(r"^[A-Za-z]{4,}$", frag)
        and re.match(r"^[A-Za-z]{6,}$", t)
        and len(t) >= len(frag) + 3
        and t.lower().endswith(frag.lower())
    )


def _is_noisy_evidence_sample(sample: Any) -> bool:
    text = str(sample or "").strip()
    if not text:
        return True
    if re.match(
        r"^异议(?:[!！。\s]|\[doge\]|（幻听）)*$",
        text,
    ):
        return True
    if text == "掉小珍珠了，呜呜":
        return True
    if re.search(
        r"百度网盘分享的文件|通过百度网盘分享|超级会员v?\d+",
        text,
        re.IGNORECASE,
    ):
        return True
    return False
