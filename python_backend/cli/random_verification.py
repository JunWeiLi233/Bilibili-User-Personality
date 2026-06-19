from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

from python_backend.analysis.verification import RandomVerifier
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


def json_result_bytes(result: dict[str, Any]) -> bytes:
    return (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Python random verification over JS-compatible corpus and dictionary JSON.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--sample-size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    result = RandomVerificationRunner(args.corpus, args.dictionary, sample_size=args.sample_size, seed=args.seed).run()
    sys.stdout.buffer.write(json_result_bytes(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
