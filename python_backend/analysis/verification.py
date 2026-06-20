from __future__ import annotations

import json
import random
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from python_backend.analysis.comment_coverage import _clean_needle, _is_scrape_diagnostic
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


class RandomVerificationRunner:
    """Run deterministic random corpus verification from JS-compatible JSON files."""

    def __init__(self, corpus_path: str | Path, dictionary_path: str | Path, sample_size: int = 50, seed: int = 1):
        self.corpus_path = Path(corpus_path)
        self.dictionary_path = Path(dictionary_path)
        self.sample_size = max(0, int(sample_size))
        self.seed = int(seed)

    def run(self) -> dict[str, Any]:
        corpus = CorpusLoader(self.corpus_path).load()
        dictionary = DictionaryLoader(self.dictionary_path).load()
        return RandomVerifier.from_dictionary_entries(dictionary.entries).report(
            corpus.comments,
            corpus={
                "comments": len(corpus.comments),
                "runs": len(corpus.runs),
                "storage": corpus.manifest.get("storage", "monolith"),
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
        sample_size = max(0, int(payload.get("sampleSize") or 50))
        seed = int(payload.get("seed") or 1)
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
    ):
        self.corpus_path = Path(corpus_path)
        self.dictionary_path = Path(dictionary_path)
        self.js_report_path = Path(js_report_path)
        self.sample_size = sample_size
        self.seed = seed
        self.summary = RandomVerificationReportSummary()
        self.comparator = RandomVerificationContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            js_report = json.load(handle)
        sample_size = self.sample_size if self.sample_size is not None else int(js_report.get("sampleSize") or 50)
        seed = self.seed if self.seed is not None else int(js_report.get("seed") or 1)
        python_report = RandomVerificationRunner(
            self.corpus_path,
            self.dictionary_path,
            sample_size=sample_size,
            seed=seed,
        ).run()
        return self.comparator.compare(python_report, js_report)


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
        return str(
            comment.get("message")
            or comment.get("text")
            or comment.get("commentText")
            or comment.get("combinedText")
            or comment.get("content")
            or ""
        ).strip()
