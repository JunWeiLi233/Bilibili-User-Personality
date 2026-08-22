from __future__ import annotations

import re
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_contract_scalar, _strip_mention_scaffolding
from python_backend.analysis.random_corpus import RandomVerificationCorpus
from python_backend.analysis.random_sampling import (
    RandomVerificationReportContract,
    RandomVerificationRunOptions,
    RandomVerificationSampleContract,
    VerificationSummary,
)


class RandomVerificationAnnotationContract:
    """Owns keyword matching and coverage fields for sampled verification rows."""

    def __init__(self, keyword_terms: list[str]):
        keyword_terms = keyword_terms if isinstance(keyword_terms, list) else []
        self.keyword_terms = [str(term).strip() for term in keyword_terms if _is_contract_scalar(term) and str(term).strip()]
        self.ascii_terms = {
            term: re.compile(rf"(?<![0-9a-z_]){re.escape(term.casefold())}(?![0-9a-z_])")
            for term in self.keyword_terms
            if term.isascii()
        }

    def annotate(self, comment: dict[str, Any]) -> dict[str, Any]:
        message = RandomVerificationSampleContract.message(comment)
        attributable_message = _strip_mention_scaffolding(message)
        folded_message = attributable_message.casefold()
        clean_message = _clean_needle(attributable_message)
        matched = [
            term
            for term in self.keyword_terms
            if self._matches(term, folded_message, clean_message, attributable_message)
        ]
        return {**comment, "message": message, "matched_terms": matched, "coverage": "keyword" if matched else "neutral"}

    def _matches(self, term: str, folded_message: str, clean_message: str, attributable_message: str) -> bool:
        if term in self.ascii_terms:
            return self.ascii_terms[term].search(folded_message) is not None
        clean_term = _clean_needle(term)
        if clean_term:
            return clean_term in clean_message
        return term in attributable_message


class RandomVerificationSummaryContract:
    """Owns summary metrics for annotated random-verification samples."""

    def __init__(self, samples: list[dict[str, Any]] | None = None):
        self.samples = samples if isinstance(samples, list) else []

    def build(self) -> VerificationSummary:
        keyword_hits = sum(1 for item in self.samples if isinstance(item, dict) and item.get("matched_terms"))
        return VerificationSummary(
            sampled=len(self.samples),
            keyword_hits=keyword_hits,
            neutral=len(self.samples) - keyword_hits,
            uncovered=0,
            samples=self.samples,
        )


class RandomVerificationDictionaryTermsContract:
    """Owns JS-compatible extraction of keyword terms from dictionary entries."""

    def __init__(self, entries: list[dict[str, Any]] | None = None):
        self.entries = entries if isinstance(entries, list) else []

    def terms(self) -> list[str]:
        seen: set[str] = set()
        terms: list[str] = []
        for entry in self.entries:
            if not isinstance(entry, dict):
                continue
            values = [
                entry.get("term"),
                *(entry.get("aliases") if isinstance(entry.get("aliases"), list) else []),
                *(entry.get("examples") if isinstance(entry.get("examples"), list) else []),
            ]
            for value in values:
                if not _is_contract_scalar(value):
                    continue
                term = str(value or "").strip()
                if not term or term in seen:
                    continue
                seen.add(term)
                terms.append(term)
        return terms


class RandomVerificationExecutionContract:
    """Owns the sample, annotate, and summarize flow for random verification."""

    def __init__(
        self,
        comments: list[Any] | None = None,
        annotation_contract: RandomVerificationAnnotationContract | None = None,
        sample_size: Any = 50,
        seed: Any = 1,
    ):
        self.comments = comments
        self.annotation_contract = annotation_contract or RandomVerificationAnnotationContract([])
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)

    def verify(self) -> VerificationSummary:
        sampled = RandomVerificationSampleContract(
            self.comments,
            sample_size=self.options.sample_size,
            seed=self.options.seed,
        ).sample()
        annotated = [self.annotation_contract.annotate(comment) for comment in sampled]
        return RandomVerificationSummaryContract(annotated).build()


class RandomVerificationReportBuilder:
    """Owns execution and JS-compatible report payload construction."""

    def __init__(
        self,
        comments: list[Any] | None = None,
        keyword_terms: list[str] | None = None,
        corpus: dict[str, Any] | None = None,
        sample_size: Any = 50,
        seed: Any = 1,
    ):
        self.comments = comments
        self.annotation_contract = RandomVerificationAnnotationContract(keyword_terms)
        self.keyword_terms = self.annotation_contract.keyword_terms
        self.corpus = corpus if isinstance(corpus, dict) else {}
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)

    def build(self) -> dict[str, Any]:
        sample_contract = RandomVerificationSampleContract(
            self.comments,
            sample_size=self.options.sample_size,
            seed=self.options.seed,
        )
        summary = RandomVerificationExecutionContract(
            comments=self.comments,
            annotation_contract=self.annotation_contract,
            sample_size=self.options.sample_size,
            seed=self.options.seed,
        ).verify()
        return RandomVerificationReportContract(
            corpus=self.corpus,
            dictionary_terms=len(self.keyword_terms),
            options=self.options,
            selection_summary=sample_contract.selection_summary(),
        ).build(summary)


class RandomVerificationCorpusReportBuilder:
    """Build a random-verification report from assembled corpus and dictionary entries."""

    def __init__(
        self,
        corpus: RandomVerificationCorpus,
        dictionary_entries: list[dict[str, Any]] | None = None,
        sample_size: Any = 50,
        seed: Any = 1,
    ):
        self.corpus = corpus
        self.dictionary_entries = dictionary_entries if isinstance(dictionary_entries, list) else []
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)

    def build(self) -> dict[str, Any]:
        keyword_terms = RandomVerificationDictionaryTermsContract(self.dictionary_entries).terms()
        return RandomVerificationReportBuilder(
            comments=self.corpus.comments,
            keyword_terms=keyword_terms,
            corpus=self.corpus.as_report_corpus(),
            sample_size=self.options.sample_size,
            seed=self.options.seed,
        ).build()


class RandomVerifier:
    """Deterministically sample comments and classify lexical keyword coverage."""

    def __init__(self, keyword_terms: list[str]):
        self.annotation_contract = RandomVerificationAnnotationContract(keyword_terms)
        self.keyword_terms = self.annotation_contract.keyword_terms
        self._ascii_terms = self.annotation_contract.ascii_terms

    @classmethod
    def from_dictionary_entries(cls, entries: list[dict[str, Any]]) -> "RandomVerifier":
        return cls(cls.keyword_terms_from_entries(entries))

    @staticmethod
    def keyword_terms_from_entries(entries: list[dict[str, Any]]) -> list[str]:
        return RandomVerificationDictionaryTermsContract(entries).terms()

    def verify(self, comments: list[Any], sample_size: int, seed: int) -> VerificationSummary:
        return RandomVerificationExecutionContract(
            comments=comments,
            annotation_contract=self.annotation_contract,
            sample_size=sample_size,
            seed=seed,
        ).verify()

    def report(self, comments: list[dict[str, Any]], corpus: dict[str, Any], sample_size: int, seed: int) -> dict[str, Any]:
        return RandomVerificationReportBuilder(
            comments=comments,
            keyword_terms=self.keyword_terms,
            corpus=corpus,
            sample_size=sample_size,
            seed=seed,
        ).build()

    def _annotate(self, comment: dict[str, Any]) -> dict[str, Any]:
        return self.annotation_contract.annotate(comment)

    @staticmethod
    def _message(comment: dict[str, Any]) -> str:
        return RandomVerificationSampleContract.message(comment)

    @classmethod
    def _normalize_comment(cls, comment: Any) -> dict[str, Any]:
        return RandomVerificationSampleContract.normalize_comment(comment)
