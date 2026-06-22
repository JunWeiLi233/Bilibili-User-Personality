from __future__ import annotations

import argparse
import json
import random
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_contract_scalar, _is_scrape_diagnostic, _strip_mention_scaffolding
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader


@dataclass(frozen=True)
class VerificationSummary:
    sampled: int
    keyword_hits: int
    neutral: int
    uncovered: int
    samples: list[dict[str, Any]]


def json_result_bytes(result: dict[str, Any]) -> bytes:
    return (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class RandomVerificationReportSummary:
    """Shape random-verification reports into the JS/Python comparator summary contract."""

    SUMMARY_KEYS = ("sampleSize", "seed", "sampled", "keywordHits", "neutral", "uncovered")

    def summarize(self, report: dict[str, Any] | None = None) -> dict[str, Any]:
        report = report if isinstance(report, dict) else {}
        return {key: report.get(key) for key in self.SUMMARY_KEYS}


class RandomVerificationContractComparator:
    """Compare random-verification reports using the JS/Python metric contract."""

    def __init__(self, summary: RandomVerificationReportSummary | None = None):
        self.summary = summary or RandomVerificationReportSummary()

    def compare(self, python_report: dict[str, Any] | None, js_report: dict[str, Any] | None) -> dict[str, Any]:
        python_report = python_report if isinstance(python_report, dict) else {}
        js_report = js_report if isinstance(js_report, dict) else {}
        metric_keys = tuple(key for key in self.summary.SUMMARY_KEYS if key not in ("sampleSize", "seed"))
        mismatches = [
            {"key": key, "python": python_report.get(key), "js": js_report.get(key)}
            for key in metric_keys
            if key in js_report and python_report.get(key) != js_report.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_report),
            "js": self.summary.summarize(js_report),
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
        self.sample_size = _non_negative_int(sample_size, 50)
        self.seed = _int_or(seed, 1)
        self.extra_corpus_paths = [Path(path) for path in (extra_corpus_paths or [])]

    def run(self) -> dict[str, Any]:
        corpus = CorpusLoader(self.corpus_path).load()
        comments = list(corpus.comments)
        runs = list(corpus.runs)
        storage = str(corpus.manifest.get("storage", "monolith"))
        for extra_path in self.extra_corpus_paths:
            extra_corpus = CorpusLoader(extra_path).load()
            comments.extend(extra_corpus.comments)
            runs.extend(extra_corpus.runs)
        if self.extra_corpus_paths:
            storage = "combined"
        dictionary = DictionaryLoader(self.dictionary_path).load()
        return RandomVerifier.from_dictionary_entries(dictionary.entries).report(
            comments,
            corpus={
                "comments": len(comments),
                "runs": len(runs),
                "storage": storage,
            },
            sample_size=self.sample_size,
            seed=self.seed,
        )


class RandomVerificationPayloadRunner:
    """Run deterministic random verification from a single JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        sample_size = _non_negative_int(payload.get("sampleSize"), 50)
        seed = _int_or(payload.get("seed"), 1)
        corpus = CorpusLoader.load_from_payload(payload)
        dictionary = DictionaryLoader.load_from_payload(payload)
        return RandomVerifier.from_dictionary_entries(dictionary.entries).report(
            corpus.comments,
            corpus={
                "comments": len(corpus.comments),
                "runs": len(corpus.runs),
                "storage": str(corpus.manifest.get("storage", "monolith")),
            },
            sample_size=sample_size,
            seed=seed,
        )

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class RandomVerificationJsonPayloadContractComparator:
    """Compare single-payload random verification output against a persisted JS-compatible report."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = RandomVerificationReportSummary()
        self.comparator = RandomVerificationContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            js_report = json.load(handle)
        python_report = RandomVerificationPayloadRunner(self.payload_path).run()
        return self.comparator.compare(python_report, js_report if isinstance(js_report, dict) else {})


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
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            js_report = json.load(handle)
        js_report = js_report if isinstance(js_report, dict) else {}
        sample_size = self.sample_size if self.sample_size is not None else _non_negative_int(js_report.get("sampleSize"), 50)
        seed = self.seed if self.seed is not None else _int_or(js_report.get("seed"), 1)
        python_report = RandomVerificationRunner(
            self.corpus_path,
            self.dictionary_path,
            sample_size=sample_size,
            seed=seed,
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


class RandomVerifier:
    """Deterministically sample comments and classify lexical keyword coverage."""

    def __init__(self, keyword_terms: list[str]):
        keyword_terms = keyword_terms if isinstance(keyword_terms, list) else []
        self.keyword_terms = [str(term).strip() for term in keyword_terms if _is_contract_scalar(term) and str(term).strip()]
        self._ascii_terms = {term: re.compile(rf"(?<![0-9a-z_]){re.escape(term.casefold())}(?![0-9a-z_])") for term in self.keyword_terms if term.isascii()}

    @classmethod
    def from_dictionary_entries(cls, entries: list[dict[str, Any]]) -> "RandomVerifier":
        return cls(cls.keyword_terms_from_entries(entries))

    @staticmethod
    def keyword_terms_from_entries(entries: list[dict[str, Any]]) -> list[str]:
        entries = entries if isinstance(entries, list) else []
        seen: set[str] = set()
        terms: list[str] = []
        for entry in entries:
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

    def verify(self, comments: list[Any], sample_size: int, seed: int) -> VerificationSummary:
        comments = comments if isinstance(comments, list) else []
        sample_size = _non_negative_int(sample_size, 50)
        seed = _int_or(seed, 1)
        normalized_comments = [self._normalize_comment(comment) for comment in comments]
        eligible = [comment for comment in normalized_comments if self._message(comment) and not _is_scrape_diagnostic(self._message(comment))]
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
        corpus = corpus if isinstance(corpus, dict) else {}
        sample_size = _non_negative_int(sample_size, 50)
        seed = _int_or(seed, 1)
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
        attributable_message = _strip_mention_scaffolding(message)
        folded_message = attributable_message.casefold()
        clean_message = _clean_needle(attributable_message)
        matched = [
            term
            for term in self.keyword_terms
            if (self._ascii_terms[term].search(folded_message) if term in self._ascii_terms else _clean_needle(term) in clean_message)
        ]
        return {**comment, "matched_terms": matched, "coverage": "keyword" if matched else "neutral"}

    @staticmethod
    def _message(comment: dict[str, Any]) -> str:
        return str(
            comment.get("message")
            or comment.get("text")
            or comment.get("commentText")
            or comment.get("combinedText")
            or comment.get("content")
            or ""
        ).strip()

    @classmethod
    def _normalize_comment(cls, comment: Any) -> dict[str, Any]:
        if isinstance(comment, dict):
            return comment
        text = str(comment or "").strip()
        return {"message": text} if text else {}
