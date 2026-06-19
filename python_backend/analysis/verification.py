from __future__ import annotations

import random
import re
from dataclasses import dataclass
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_scrape_diagnostic


@dataclass(frozen=True)
class VerificationSummary:
    sampled: int
    keyword_hits: int
    neutral: int
    uncovered: int
    samples: list[dict[str, Any]]


class RandomVerifier:
    """Deterministically sample comments and classify lexical keyword coverage."""

    def __init__(self, keyword_terms: list[str]):
        self.keyword_terms = [term for term in keyword_terms if term]
        self._ascii_terms = {term: re.compile(rf"(?<![0-9a-z_]){re.escape(term.casefold())}(?![0-9a-z_])") for term in self.keyword_terms if term.isascii()}

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
