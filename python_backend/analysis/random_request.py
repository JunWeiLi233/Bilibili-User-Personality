from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_backend.analysis.random_assembly import RandomVerificationCorpusAssembler, path_list
from python_backend.analysis.random_compare import (
    RandomVerificationComparisonOptionsContract,
    RandomVerificationContractComparator,
)
from python_backend.analysis.random_execution import RandomVerificationCorpusReportBuilder
from python_backend.analysis.random_output import RandomVerificationOutputWriter
from python_backend.analysis.random_report import RandomVerificationReportSummary
from python_backend.analysis.random_sampling import RandomVerificationRunOptions
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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
    output_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        result = RandomVerificationRequestDispatcher(
            corpus_path=self.corpus_path,
            dictionary_path=self.dictionary_path,
            sample_size=self.sample_size,
            seed=self.seed,
            extra_corpus_paths=self.extra_corpus_paths,
            payload_path=self.payload_path,
            compare_js_report_path=self.compare_js_report_path,
        ).run()
        if self.output_path is not None and str(self.output_path).strip():
            return RandomVerificationOutputWriter(self.output_path).write(result)
        return result


@dataclass(frozen=True)
class RandomVerificationRequestDispatcher:
    """Dispatch random-verification request modes without leaking CLI branching."""

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
        return RandomVerificationCommandContract(self.argv).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        return RandomVerificationCommandContract.parser()


class RandomVerificationCommandContract:
    """Own argv parsing and request construction for random verification."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def request(self) -> RandomVerificationRequest:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return RandomVerificationRequest(
            corpus_path=args.corpus,
            dictionary_path=args.dictionary,
            sample_size=args.sample_size,
            seed=args.seed,
            extra_corpus_paths=args.extra_corpus,
            payload_path=args.payload or None,
            compare_js_report_path=args.compare_js_report or None,
            output_path=args.output or None,
        )

    def run(self) -> dict[str, Any]:
        return self.request().run()

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
        parser.add_argument("--output", default="", help="Optional path to write the random-verification JSON result.")
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
        self.extra_corpus_paths = path_list(extra_corpus_paths)

    def run(self) -> dict[str, Any]:
        corpus = RandomVerificationCorpusAssembler.from_path(self.corpus_path, self.extra_corpus_paths).assemble()
        dictionary = DictionaryLoader(self.dictionary_path).load()
        return RandomVerificationCorpusReportBuilder(
            corpus=corpus,
            dictionary_entries=dictionary.entries,
            sample_size=self.sample_size,
            seed=self.seed,
        ).build()


class RandomVerificationPayloadRunner:
    """Run deterministic random verification from a single JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        options = RandomVerificationRunOptions.from_payload(payload)
        corpus = RandomVerificationCorpusAssembler.from_payload(payload).assemble()
        dictionary = DictionaryLoader.load_from_payload(payload)
        return RandomVerificationCorpusReportBuilder(
            corpus=corpus,
            dictionary_entries=dictionary.entries,
            sample_size=options.sample_size,
            seed=options.seed,
        ).build()

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


class RandomVerificationReportFileComparator:
    """Compare persisted Python and JS random-verification reports."""

    def __init__(self, python_report_path: str | Path, js_report_path: str | Path):
        self.python_report_path = Path(python_report_path)
        self.js_report_path = Path(js_report_path)
        self.comparator = RandomVerificationContractComparator(RandomVerificationReportSummary())

    def compare(self) -> dict[str, Any]:
        return self.comparator.compare(
            safe_read_json_object(self.python_report_path),
            safe_read_json_object(self.js_report_path),
        )


class RandomVerificationCompareCommandRequest:
    """Parse persisted-report compare argv while keeping comparison ownership in Python."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Compare persisted Python and JS random-verification JSON reports.")
        parser.add_argument("--python-report", required=True)
        parser.add_argument("--js-report", default="")
        parser.add_argument("--compare-js-report", default="")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        js_report_path = args.compare_js_report or args.js_report
        if not js_report_path:
            return {"ok": False, "error": "--js-report or --compare-js-report is required"}
        return RandomVerificationReportFileComparator(args.python_report, js_report_path).compare()


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
        options = RandomVerificationComparisonOptionsContract(
            sample_size=self.sample_size,
            seed=self.seed,
            js_report=js_report,
        ).options()
        python_report = RandomVerificationRunner(
            self.corpus_path,
            self.dictionary_path,
            sample_size=options.sample_size,
            seed=options.seed,
            extra_corpus_paths=self.extra_corpus_paths,
        ).run()
        return self.comparator.compare(python_report, js_report)
