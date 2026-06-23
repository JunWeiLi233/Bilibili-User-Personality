from __future__ import annotations

import argparse
import base64
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.runtime.json_contracts import safe_read_json_object


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


class DictionaryPruneSummary:
    """Shape dictionary prune dry-run output into the JS/Python comparator contract."""

    RESULT_KEYS = ("entries", "asciiTerms", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class DictionaryPruneSummaryContractComparator:
    """Compare dictionary prune summaries using the JS/Python JSON contract."""

    def __init__(self, summary: DictionaryPruneSummary | None = None):
        self.summary = summary or DictionaryPruneSummary()

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


class DictionaryPruneSummaryRunner:
    """Build a Python dry-run summary for the JS dictionary prune command."""

    def __init__(self, dictionary_path: str | Path):
        self.dictionary_path = Path(dictionary_path)

    def run(self) -> dict[str, Any]:
        loaded = DictionaryLoader(self.dictionary_path).load()
        plan = DictionaryPrunePlanner().build(loaded.entries)
        return {
            "ok": True,
            "dictionaryPath": str(self.dictionary_path),
            **plan,
        }


class DictionaryPruneSummaryPayloadContractComparator:
    """Compare file-backed Python prune summaries against a saved JS-compatible JSON report."""

    def __init__(self, dictionary_path: str | Path, js_report_path: str | Path):
        self.dictionary_path = Path(dictionary_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DictionaryPruneSummary()
        self.comparator = DictionaryPruneSummaryContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = DictionaryPruneSummaryRunner(self.dictionary_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class DictionaryPruneSummaryRequest:
    """Corpus-layer request for dictionary prune summary JSON contract commands."""

    def __init__(self, dictionary_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.dictionary_path = Path(dictionary_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return DictionaryPruneSummaryPayloadContractComparator(self.dictionary_path, self.compare_js_report_path).compare()
        return DictionaryPruneSummaryRunner(self.dictionary_path).run()


class DictionaryPruneSummaryCommandRequest:
    """Argv-backed corpus-layer command request for dictionary prune summary commands."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a dry-run summary for dictionary pruning compatibility.")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible prune summary JSON to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = self.parser().parse_args(argv)
        return DictionaryPruneSummaryRequest(args.dictionary, compare_js_report_path=args.compare_js_report or None).run()


class ExhaustedTermsPrunePlanSummary:
    """Shape exhausted-term prune plans into the JS/Python comparator contract."""

    RESULT_KEYS = ("count", "candidates", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class ExhaustedTermsPrunePlanContractComparator:
    """Compare exhausted-term prune plans using the JS/Python JSON contract."""

    def __init__(self, summary: ExhaustedTermsPrunePlanSummary | None = None):
        self.summary = summary or ExhaustedTermsPrunePlanSummary()

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


class ExhaustedTermsPrunePlanRunner:
    """Build a dry-run prune plan for repeatedly missed dictionary terms."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        *,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.target_evidence = target_evidence
        self.attempt_threshold = attempt_threshold
        self.require_zero_evidence = require_zero_evidence
        self.require_source_backed_evidence = require_source_backed_evidence
        self.require_comment_backed_evidence = require_comment_backed_evidence

    def run(self) -> dict[str, Any]:
        loaded_dictionary = DictionaryLoader(self.dictionary_path).load()
        dictionary = {**loaded_dictionary.manifest, "entries": loaded_dictionary.entries}
        state = self._read_json(self.state_path, {"termAttempts": {}})
        return ExhaustedTermsPrunePlanner(
            target_evidence=self.target_evidence,
            attempt_threshold=self.attempt_threshold,
            require_zero_evidence=self.require_zero_evidence,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
        ).build_plan(dictionary, state)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class ExhaustedTermsPrunePlanPayloadContractComparator:
    """Compare file-backed exhausted-term prune plans against saved JS-compatible JSON."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        js_report_path: str | Path,
        *,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.js_report_path = Path(js_report_path)
        self.target_evidence = target_evidence
        self.attempt_threshold = attempt_threshold
        self.require_zero_evidence = require_zero_evidence
        self.require_source_backed_evidence = require_source_backed_evidence
        self.require_comment_backed_evidence = require_comment_backed_evidence
        self.summary = ExhaustedTermsPrunePlanSummary()
        self.comparator = ExhaustedTermsPrunePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = ExhaustedTermsPrunePlanRunner(
            self.dictionary_path,
            self.state_path,
            target_evidence=self.target_evidence,
            attempt_threshold=self.attempt_threshold,
            require_zero_evidence=self.require_zero_evidence,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
        ).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class ExhaustedTermsPrunePlanRequest:
    """Corpus-layer request for exhausted-term prune plan JSON contract commands."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        *,
        compare_js_report_path: str | Path | None = None,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.target_evidence = target_evidence
        self.attempt_threshold = attempt_threshold
        self.require_zero_evidence = require_zero_evidence
        self.require_source_backed_evidence = require_source_backed_evidence
        self.require_comment_backed_evidence = require_comment_backed_evidence

    def run(self) -> dict[str, Any]:
        options = {
            "target_evidence": self.target_evidence,
            "attempt_threshold": self.attempt_threshold,
            "require_zero_evidence": self.require_zero_evidence,
            "require_source_backed_evidence": self.require_source_backed_evidence,
            "require_comment_backed_evidence": self.require_comment_backed_evidence,
        }
        if self.compare_js_report_path:
            return ExhaustedTermsPrunePlanPayloadContractComparator(
                self.dictionary_path,
                self.state_path,
                self.compare_js_report_path,
                **options,
            ).compare()
        return ExhaustedTermsPrunePlanRunner(self.dictionary_path, self.state_path, **options).run()


class ExhaustedTermsPrunePlanCommandRequest:
    """Argv-backed corpus-layer command request for exhausted-term prune planning."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a dry-run prune plan for exhausted dictionary terms.")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--state", default="server/data/keywordHarvestState.json")
        parser.add_argument("--target-evidence", type=int, default=3)
        parser.add_argument("--attempt-threshold", type=int, default=10)
        parser.add_argument("--include-partial", action="store_true", help="Include terms below target evidence, not only zero-evidence terms.")
        parser.add_argument("--require-source-backed-evidence", action="store_true")
        parser.add_argument("--require-comment-backed-evidence", action="store_true")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible exhausted-term prune report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = self.parser().parse_args(argv)
        return ExhaustedTermsPrunePlanRequest(
            args.dictionary,
            args.state,
            compare_js_report_path=args.compare_js_report or None,
            target_evidence=args.target_evidence,
            attempt_threshold=args.attempt_threshold,
            require_zero_evidence=not args.include_partial,
            require_source_backed_evidence=args.require_source_backed_evidence,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
        ).run()


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


class ExhaustedTermsPrunePlanner:
    """Build a JS-compatible prune plan for repeatedly missed dictionary terms."""

    def __init__(
        self,
        *,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.target_evidence = self._positive_int(target_evidence, 3, 1000)
        self.attempt_threshold = self._positive_int(attempt_threshold, 10, 100000)
        self.require_zero_evidence = require_zero_evidence is not False
        self.require_source_backed_evidence = require_source_backed_evidence is True
        self.require_comment_backed_evidence = require_comment_backed_evidence is True

    def build_plan(self, dictionary: dict[str, Any] | None = None, state: dict[str, Any] | None = None) -> dict[str, Any]:
        candidates = self.select_candidates(dictionary, state)
        return {
            "ok": True,
            "targetEvidence": self.target_evidence,
            "attemptThreshold": self.attempt_threshold,
            "requireZeroEvidence": self.require_zero_evidence,
            "requireSourceBackedEvidence": self.require_source_backed_evidence,
            "requireCommentBackedEvidence": self.require_comment_backed_evidence,
            "count": len(candidates),
            "candidates": candidates,
            "summary": {
                "attemptThreshold": self.attempt_threshold,
                "requireZeroEvidence": self.require_zero_evidence,
                "candidates": len(candidates),
            },
        }

    def select_candidates(self, dictionary: dict[str, Any] | None = None, state: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        state = state if isinstance(state, dict) else {}
        audit = CoverageAuditBuilder(
            target_evidence=self.target_evidence,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
        )
        term_attempts = state.get("termAttempts") if isinstance(state.get("termAttempts"), dict) else {}
        exhausted: list[dict[str, Any]] = []
        entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            term = str(entry.get("term") or "").strip()
            if not term:
                continue
            evidence = audit._coverage_evidence_count(entry)
            if evidence >= self.target_evidence:
                continue
            if self.require_zero_evidence and evidence > 0:
                continue
            attempts = self._attempts_for_term(term_attempts, term)
            if attempts >= self.attempt_threshold:
                exhausted.append({"term": term, "family": entry.get("family") or "", "attempts": attempts, "evidence": evidence})
        return exhausted

    def _attempts_for_term(self, term_attempts: dict[str, Any], term: str) -> int:
        raw = term_attempts.get(term)
        if not isinstance(raw, dict):
            raw = term_attempts.get(self._term_attempt_key(term))
        if not isinstance(raw, dict):
            return 0
        return max(0, int(float(raw.get("attempts") or 0)))

    def _term_attempt_key(self, term: str) -> str:
        encoded = base64.urlsafe_b64encode(term.encode("utf-8")).decode("ascii")
        return encoded.rstrip("=")

    def _positive_int(self, value: Any, fallback: int, max_value: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = fallback
        return min(max_value, max(1, parsed))
