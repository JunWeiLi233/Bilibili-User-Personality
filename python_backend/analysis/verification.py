from __future__ import annotations

import argparse
import json
import os
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_contract_scalar, _is_scrape_diagnostic, _strip_mention_scaffolding
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


@dataclass(frozen=True)
class VerificationSummary:
    sampled: int
    keyword_hits: int
    neutral: int
    uncovered: int
    samples: list[dict[str, Any]]


@dataclass(frozen=True)
class RandomVerificationCorpus:
    """Loaded corpus bundle used by random verification reports."""

    comments: list[dict[str, Any]]
    runs: list[dict[str, Any]]
    storage: str

    def as_report_corpus(self) -> dict[str, Any]:
        return {
            "comments": len(self.comments),
            "runs": len(self.runs),
            "storage": self.storage,
        }


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

    def build(self, summary: VerificationSummary) -> dict[str, Any]:
        return {
            "ok": True,
            "corpus": self.corpus if isinstance(self.corpus, dict) else {},
            "dictionaryTerms": self.dictionary_terms,
            **self.options.as_report_fields(),
            "sampled": summary.sampled,
            "keywordHits": summary.keyword_hits,
            "neutral": summary.neutral,
            "uncovered": summary.uncovered,
            "samples": summary.samples,
        }


def json_result_bytes(result: dict[str, Any]) -> bytes:
    return (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class RandomVerificationReportSummary:
    """Shape random-verification reports into the JS/Python comparator summary contract."""

    SUMMARY_KEYS = ("sampleSize", "seed", "sampled", "keywordHits", "neutral", "uncovered")

    def summarize(self, report: dict[str, Any] | None = None) -> dict[str, Any]:
        report = report if isinstance(report, dict) else {}
        return {
            "sampleSize": _non_negative_int(report.get("sampleSize"), 50),
            "seed": _int_or(report.get("seed"), 1),
            "sampled": _non_negative_int(report.get("sampled"), 0),
            "keywordHits": _non_negative_int(report.get("keywordHits"), 0),
            "neutral": _non_negative_int(report.get("neutral"), 0),
            "uncovered": _non_negative_int(report.get("uncovered"), 0),
        }


class RandomVerificationSampleContract:
    """Normalize, filter, and deterministically sample random-verification comments."""

    def __init__(self, comments: list[Any] | None = None, sample_size: Any = 50, seed: Any = 1):
        self.comments = comments if isinstance(comments, list) else []
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)

    def sample(self) -> list[dict[str, Any]]:
        eligible = [comment for comment in self.normalized_comments() if self.message(comment) and not _is_scrape_diagnostic(self.message(comment))]
        sample_count = min(max(0, self.options.sample_size), len(eligible))
        return random.Random(self.options.seed).sample(eligible, sample_count) if sample_count else []

    def normalized_comments(self) -> list[dict[str, Any]]:
        return [self.normalize_comment(comment) for comment in self.comments]

    @staticmethod
    def message(comment: dict[str, Any]) -> str:
        return str(
            comment.get("message")
            or comment.get("text")
            or comment.get("commentText")
            or comment.get("combinedText")
            or comment.get("content")
            or ""
        ).strip()

    @classmethod
    def normalize_comment(cls, comment: Any) -> dict[str, Any]:
        if isinstance(comment, dict):
            return comment
        text = str(comment or "").strip()
        return {"message": text} if text else {}


class RandomVerificationContractComparator:
    """Compare random-verification reports using the JS/Python metric contract."""

    def __init__(self, summary: RandomVerificationReportSummary | None = None):
        self.summary = summary or RandomVerificationReportSummary()

    def compare(self, python_report: dict[str, Any] | None, js_report: dict[str, Any] | None) -> dict[str, Any]:
        python_report = python_report if isinstance(python_report, dict) else {}
        js_report = js_report if isinstance(js_report, dict) else {}
        python_summary = self.summary.summarize(python_report)
        js_summary = self.summary.summarize(js_report)
        metric_keys = tuple(key for key in self.summary.SUMMARY_KEYS if key not in ("sampleSize", "seed"))
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in metric_keys
            if key in js_report and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


@dataclass(frozen=True)
class RandomVerificationRequest:
    """Analysis-layer request object for random-verification JSON contract modes."""

    corpus_path: str | Path = "server/data/bilibiliDirectProbeCorpus.json"
    dictionary_path: str | Path = "server/data/deepseekKeywordDictionary.json"
    sample_size: Any = 50
    seed: Any = 1
    extra_corpus_paths: list[str | Path] | None = None
    payload_path: str | Path | None = None
    compare_js_report_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        if self.payload_path and self.compare_js_report_path:
            return RandomVerificationJsonPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        if self.payload_path:
            return RandomVerificationPayloadRunner(self.payload_path).run()
        if self.compare_js_report_path:
            return RandomVerificationPayloadContractComparator(
                self.corpus_path,
                self.dictionary_path,
                self.compare_js_report_path,
                sample_size=self.sample_size if self.sample_size is not None else None,
                seed=self.seed if self.seed is not None else None,
                extra_corpus_paths=self.extra_corpus_paths,
            ).compare()
        return RandomVerificationRunner(
            self.corpus_path,
            self.dictionary_path,
            sample_size=self.sample_size if self.sample_size is not None else 50,
            seed=self.seed if self.seed is not None else 1,
            extra_corpus_paths=self.extra_corpus_paths,
        ).run()


class RandomVerificationCommandRequest:
    """Analysis-layer command request for random-verification CLI JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return RandomVerificationRequest(
            corpus_path=args.corpus,
            dictionary_path=args.dictionary,
            sample_size=args.sample_size,
            seed=args.seed,
            extra_corpus_paths=args.extra_corpus,
            payload_path=args.payload or None,
            compare_js_report_path=args.compare_js_report or None,
        ).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Run Python random verification over JS-compatible corpus and dictionary JSON.")
        parser.add_argument("--payload", default="")
        parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
        parser.add_argument("--extra-corpus", action="append", default=[])
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--sample-size", type=int)
        parser.add_argument("--seed", type=int)
        parser.add_argument("--compare-js-report", default="")
        return parser


class RandomVerificationRunner:
    """Run deterministic random corpus verification from JS-compatible JSON files."""

    def __init__(
        self,
        corpus_path: str | Path,
        dictionary_path: str | Path,
        sample_size: Any = 50,
        seed: Any = 1,
        extra_corpus_paths: list[str | Path] | None = None,
    ):
        self.corpus_path = Path(corpus_path)
        self.dictionary_path = Path(dictionary_path)
        self.options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)
        self.sample_size = self.options.sample_size
        self.seed = self.options.seed
        self.extra_corpus_paths = _path_list(extra_corpus_paths)

    def run(self) -> dict[str, Any]:
        corpus = RandomVerificationCorpusAssembler.from_path(self.corpus_path, self.extra_corpus_paths).assemble()
        dictionary = DictionaryLoader(self.dictionary_path).load()
        return RandomVerifier.from_dictionary_entries(dictionary.entries).report(
            corpus.comments,
            corpus=corpus.as_report_corpus(),
            sample_size=self.sample_size,
            seed=self.seed,
        )


class RandomVerificationPayloadRunner:
    """Run deterministic random verification from a single JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        options = RandomVerificationRunOptions.from_payload(payload)
        corpus = RandomVerificationCorpusAssembler.from_payload(payload).assemble()
        dictionary = DictionaryLoader.load_from_payload(payload)
        return RandomVerifier.from_dictionary_entries(dictionary.entries).report(
            corpus.comments,
            corpus=corpus.as_report_corpus(),
            sample_size=options.sample_size,
            seed=options.seed,
        )

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {"corpus": {}, "dictionary": {}})
        return payload if isinstance(payload, dict) else {}


class RandomVerificationJsonPayloadContractComparator:
    """Compare single-payload random verification output against a persisted JS-compatible report."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = RandomVerificationReportSummary()
        self.comparator = RandomVerificationContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        js_report = safe_read_json_object(self.js_report_path)
        python_report = RandomVerificationPayloadRunner(self.payload_path).run()
        return self.comparator.compare(python_report, js_report)


class RandomVerificationPayloadContractComparator:
    """Compare Python random verification against a persisted JS-compatible report."""

    def __init__(
        self,
        corpus_path: str | Path,
        dictionary_path: str | Path,
        js_report_path: str | Path,
        sample_size: int | None = None,
        seed: int | None = None,
        extra_corpus_paths: list[str | Path] | None = None,
    ):
        self.corpus_path = Path(corpus_path)
        self.dictionary_path = Path(dictionary_path)
        self.js_report_path = Path(js_report_path)
        self.sample_size = sample_size
        self.seed = seed
        self.extra_corpus_paths = extra_corpus_paths or []
        self.summary = RandomVerificationReportSummary()
        self.comparator = RandomVerificationContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        js_report = safe_read_json_object(self.js_report_path)
        options = RandomVerificationRunOptions.from_values(
            sample_size=self.sample_size if self.sample_size is not None else js_report.get("sampleSize"),
            seed=self.seed if self.seed is not None else js_report.get("seed"),
        )
        python_report = RandomVerificationRunner(
            self.corpus_path,
            self.dictionary_path,
            sample_size=options.sample_size,
            seed=options.seed,
            extra_corpus_paths=self.extra_corpus_paths,
        ).run()
        return self.comparator.compare(python_report, js_report)


def _int_or(value: Any, fallback: int) -> int:
    try:
        return int(value if value is not None else fallback)
    except (TypeError, ValueError):
        return fallback


def _non_negative_int(value: Any, fallback: int) -> int:
    return max(0, _int_or(value, fallback))


def _path_list(value: Any) -> list[Path]:
    if not isinstance(value, list):
        return []
    paths: list[Path] = []
    for item in value:
        if isinstance(item, os.PathLike):
            paths.append(Path(item))
            continue
        if isinstance(item, str) and item.strip():
            paths.append(Path(item))
    return paths


class RandomVerificationCorpusAssembler:
    """Assemble the base and optional extra corpora for random verification."""

    def __init__(self, base_corpus: Any, extra_corpus_paths: list[str | Path] | None = None):
        self.base_corpus = base_corpus
        self.extra_corpus_paths = _path_list(extra_corpus_paths)

    @classmethod
    def from_path(cls, corpus_path: str | Path, extra_corpus_paths: list[str | Path] | None = None) -> "RandomVerificationCorpusAssembler":
        return cls(CorpusLoader(corpus_path), extra_corpus_paths)

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "RandomVerificationCorpusAssembler":
        payload = payload if isinstance(payload, dict) else {}
        return cls(CorpusLoader.load_from_payload(payload), _path_list(payload.get("extraCorpusPaths")))

    def assemble(self) -> RandomVerificationCorpus:
        base = self._load_base()
        comments = list(base.comments)
        runs = list(base.runs)
        storage = str(base.manifest.get("storage", "monolith"))
        for extra_path in self.extra_corpus_paths:
            extra_corpus = CorpusLoader(extra_path).load()
            comments.extend(extra_corpus.comments)
            runs.extend(extra_corpus.runs)
        if self.extra_corpus_paths:
            storage = "combined"
        return RandomVerificationCorpus(comments=comments, runs=runs, storage=storage)

    def _load_base(self):
        return self.base_corpus.load() if hasattr(self.base_corpus, "load") else self.base_corpus


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
        return {**comment, "matched_terms": matched, "coverage": "keyword" if matched else "neutral"}

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
        options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)
        sampled = RandomVerificationSampleContract(comments, sample_size=options.sample_size, seed=options.seed).sample()
        annotated = [self._annotate(comment) for comment in sampled]
        return RandomVerificationSummaryContract(annotated).build()

    def report(self, comments: list[dict[str, Any]], corpus: dict[str, Any], sample_size: int, seed: int) -> dict[str, Any]:
        corpus = corpus if isinstance(corpus, dict) else {}
        options = RandomVerificationRunOptions.from_values(sample_size=sample_size, seed=seed)
        summary = self.verify(comments, sample_size=options.sample_size, seed=options.seed)
        return RandomVerificationReportContract(corpus=corpus, dictionary_terms=len(self.keyword_terms), options=options).build(summary)

    def _annotate(self, comment: dict[str, Any]) -> dict[str, Any]:
        return self.annotation_contract.annotate(comment)

    @staticmethod
    def _message(comment: dict[str, Any]) -> str:
        return RandomVerificationSampleContract.message(comment)

    @classmethod
    def _normalize_comment(cls, comment: Any) -> dict[str, Any]:
        return RandomVerificationSampleContract.normalize_comment(comment)
