from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from python_backend.analysis.comment_coverage import _is_scrape_diagnostic


def _int_or(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _non_negative_int(value: Any, fallback: int = 0) -> int:
    return max(0, _int_or(value, fallback))


@dataclass(frozen=True)
class VerificationSummary:
    sampled: int
    keyword_hits: int
    neutral: int
    uncovered: int
    samples: list[dict[str, Any]]


@dataclass(frozen=True)
class RandomVerificationRunOptions:
    """Normalize random-verification run controls from JS-compatible payloads."""

    sample_size: int = 50
    seed: int = 1

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "RandomVerificationRunOptions":
        payload = payload if isinstance(payload, dict) else {}
        return cls.from_values(sample_size=payload.get("sampleSize"), seed=payload.get("seed"))

    @classmethod
    def from_values(cls, sample_size: Any = 50, seed: Any = 1) -> "RandomVerificationRunOptions":
        return cls(sample_size=_non_negative_int(sample_size, 50), seed=_int_or(seed, 1))

    def as_report_fields(self) -> dict[str, int]:
        return {"sampleSize": self.sample_size, "seed": self.seed}


@dataclass(frozen=True)
class RandomVerificationReportContract:
    """Build the JS-compatible random verification report payload."""

    corpus: dict[str, Any]
    dictionary_terms: int
    options: RandomVerificationRunOptions
    selection_summary: dict[str, int] | None = None

    def build(self, summary: VerificationSummary) -> dict[str, Any]:
        return {
            "ok": True,
            "corpus": self.corpus if isinstance(self.corpus, dict) else {},
            "dictionaryTerms": self.dictionary_terms,
            **self.options.as_report_fields(),
            "selectionSummary": self.selection_summary if isinstance(self.selection_summary, dict) else {},
            "sampled": summary.sampled,
            "keywordHits": summary.keyword_hits,
            "neutral": summary.neutral,
            "uncovered": summary.uncovered,
            "samples": summary.samples,
        }


class RandomVerificationSampleContract:
    """Normalize, filter, and deterministically sample random-verification comments."""

    def __init__(self, comments: list[Any] | None = None, sample_size: Any = 50, seed: Any = 1):
        self.comments = comments if isinstance(comments, list) else []
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)

    def sample(self) -> list[dict[str, Any]]:
        eligible = self.eligible_comments()
        sample_count = min(max(0, self.options.sample_size), len(eligible))
        return random.Random(self.options.seed).sample(eligible, sample_count) if sample_count else []

    def eligible_comments(self) -> list[dict[str, Any]]:
        return [
            comment
            for comment in self.normalized_comments()
            if self.message(comment) and not _is_scrape_diagnostic(self.message(comment))
        ]

    def selection_summary(self) -> dict[str, int]:
        eligible_count = len(self.eligible_comments())
        selected_count = min(max(0, self.options.sample_size), eligible_count)
        return {
            "requestedSampleSize": self.options.sample_size,
            "eligibleComments": eligible_count,
            "selectedComments": selected_count,
            "seed": self.options.seed,
        }

    def normalized_comments(self) -> list[dict[str, Any]]:
        return [self.normalize_comment(comment) for comment in self.comments]

    @staticmethod
    def message(comment: dict[str, Any]) -> str:
        return str(
            comment.get("message")
            or comment.get("text")
            or comment.get("msg")
            or comment.get("commentText")
            or comment.get("combinedText")
            or RandomVerificationSampleContract._content_message(comment.get("content"))
            or ""
        ).strip()

    @staticmethod
    def _content_message(content: Any) -> Any:
        if isinstance(content, dict):
            return content.get("message")
        return content

    @classmethod
    def normalize_comment(cls, comment: Any) -> dict[str, Any]:
        if isinstance(comment, dict):
            return comment
        text = str(comment or "").strip()
        return {"message": text} if text else {}
