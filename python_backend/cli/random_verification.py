from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

from python_backend.analysis.verification import RandomVerificationReportSummary, RandomVerifier
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
        terms = self._keyword_terms(dictionary.entries)
        summary = RandomVerifier(terms).verify(corpus.comments, sample_size=self.sample_size, seed=self.seed)
        payload = asdict(summary)
        return {
            "ok": True,
            "corpus": {
                "comments": len(corpus.comments),
                "runs": len(corpus.runs),
                "storage": corpus.manifest.get("storage", "monolith"),
            },
            "dictionaryTerms": len([term for term in terms if term]),
            "sampleSize": self.sample_size,
            "seed": self.seed,
            "sampled": payload["sampled"],
            "keywordHits": payload["keyword_hits"],
            "neutral": payload["neutral"],
            "uncovered": payload["uncovered"],
            "samples": payload["samples"],
        }

    def _keyword_terms(self, entries: list[dict[str, Any]]) -> list[str]:
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
