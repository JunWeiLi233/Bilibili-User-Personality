from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.verification import RandomVerificationContractComparator as RandomVerificationPayloadComparator, RandomVerificationReportSummary, RandomVerifier
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader


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


class RandomVerificationContractComparator:
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
        self.comparator = RandomVerificationPayloadComparator(self.summary)

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


def json_result_bytes(result: dict[str, Any]) -> bytes:
    return (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Python random verification over JS-compatible corpus and dictionary JSON.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--sample-size", type=int)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--compare-js-report", default="")
    args = parser.parse_args()
    if args.compare_js_report:
        result = RandomVerificationContractComparator(
            args.corpus,
            args.dictionary,
            args.compare_js_report,
            sample_size=args.sample_size,
            seed=args.seed,
        ).compare()
    else:
        result = RandomVerificationRunner(
            args.corpus,
            args.dictionary,
            sample_size=args.sample_size if args.sample_size is not None else 50,
            seed=args.seed if args.seed is not None else 1,
        ).run()
    sys.stdout.buffer.write(json_result_bytes(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
