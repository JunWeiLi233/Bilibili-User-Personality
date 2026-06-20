from __future__ import annotations

import random
import re
from dataclasses import asdict, dataclass
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_scrape_diagnostic


@dataclass(frozen=True)
class VerificationSummary:
    sampled: int
    keyword_hits: int
    neutral: int
    uncovered: int
    samples: list[dict[str, Any]]


class RandomVerificationReportSummary:
    """Shape random-verification reports into the JS/Python comparator summary contract."""

    SUMMARY_KEYS = ("sampleSize", "seed", "sampled", "keywordHits", "neutral", "uncovered")

    def summarize(self, report: dict[str, Any] | None = None) -> dict[str, Any]:
        report = report if isinstance(report, dict) else {}
        return {key: report.get(key) for key in self.SUMMARY_KEYS}


class RandomVerifier:
    """Deterministically sample comments and classify lexical keyword coverage."""

    def __init__(self, keyword_terms: list[str]):
        self.keyword_terms = [term for term in keyword_terms if term]
        self._ascii_terms = {term: re.compile(rf"(?<![0-9a-z_]){re.escape(term.casefold())}(?![0-9a-z_])") for term in self.keyword_terms if term.isascii()}

    @classmethod
    def from_dictionary_entries(cls, entries: list[dict[str, Any]]) -> "RandomVerifier":
        return cls(cls.keyword_terms_from_entries(entries))

    @staticmethod
    def keyword_terms_from_entries(entries: list[dict[str, Any]]) -> list[str]:
        seen: set[str] = set()
        terms: list[str] = []
        for entry in entries:
            values = [
                entry.get("term"),
                *(entry.get("aliases") if isinstance(entry.get("aliases"), list) else []),
                *(entry.get("examples") if isinstance(entry.get("examples"), list) else []),
            ]
            for value in values:
                term = str(value or "").strip()
                if not term or term in seen:
                    continue
                seen.add(term)
                terms.append(term)
        return terms

    def verify(self, comments: list[dict[str, Any]], sample_size: int, seed: int) -> VerificationSummary:
        eligible = [comment for comment in comments if self._message(comment) and not _is_scrape_diagnostic(self._message(comment))]
        sample_count = min(max(0, sample_size), len(eligible))
        sampled = random.Random(seed).sample(eligible, sample_count) if sample_count else []
        annotated = [self._annotate(comment) for comment in sampled]
        keyword_hits = sum(1 for item in annotated if item["matched_terms"])
        return VerificationSummary(
            sampled=len(annotated),
            keyword_hits=keyword_hits,
            neutral=len(annotated) - keyword_hits,
            uncovered=0,
            samples=annotated,
        )

    def report(self, comments: list[dict[str, Any]], corpus: dict[str, Any], sample_size: int, seed: int) -> dict[str, Any]:
        summary = asdict(self.verify(comments, sample_size=sample_size, seed=seed))
        return {
            "ok": True,
            "corpus": corpus,
            "dictionaryTerms": len(self.keyword_terms),
            "sampleSize": sample_size,
            "seed": seed,
            "sampled": summary["sampled"],
            "keywordHits": summary["keyword_hits"],
            "neutral": summary["neutral"],
            "uncovered": summary["uncovered"],
            "samples": summary["samples"],
        }

    def _annotate(self, comment: dict[str, Any]) -> dict[str, Any]:
        message = self._message(comment)
        folded_message = message.casefold()
        clean_message = _clean_needle(message)
        matched = [
            term
            for term in self.keyword_terms
            if (self._ascii_terms[term].search(folded_message) if term in self._ascii_terms else _clean_needle(term) in clean_message)
        ]
        return {**comment, "matched_terms": matched, "coverage": "keyword" if matched else "neutral"}

    @staticmethod
    def _message(comment: dict[str, Any]) -> str:
        return str(comment.get("message") or comment.get("text") or comment.get("content") or "").strip()
