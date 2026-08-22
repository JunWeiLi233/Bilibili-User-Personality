from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from python_backend.analysis.random_corpus import RandomVerificationCorpus
from python_backend.corpus.loader import CorpusLoader


def path_list(value: Any) -> list[Path]:
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


def payload_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


class RandomVerificationCorpusAssembler:
    """Assemble the base and optional extra corpora for random verification."""

    def __init__(
        self,
        base_corpus: Any,
        extra_corpus_paths: list[str | Path] | None = None,
        extra_corpus_payloads: list[dict[str, Any]] | None = None,
    ):
        self.base_corpus = base_corpus
        self.extra_corpus_paths = path_list(extra_corpus_paths)
        self.extra_corpus_payloads = extra_corpus_payloads if isinstance(extra_corpus_payloads, list) else []

    @classmethod
    def from_path(cls, corpus_path: str | Path, extra_corpus_paths: list[str | Path] | None = None) -> "RandomVerificationCorpusAssembler":
        return cls(CorpusLoader(corpus_path), extra_corpus_paths)

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "RandomVerificationCorpusAssembler":
        payload = payload if isinstance(payload, dict) else {}
        return cls(
            CorpusLoader.load_from_payload(payload),
            path_list(payload.get("extraCorpusPaths")),
            payload_list(payload.get("extraCorpora")),
        )

    def assemble(self) -> RandomVerificationCorpus:
        base = self._load_base()
        comments = list(base.comments)
        runs = list(base.runs)
        storage = str(base.manifest.get("storage", "monolith"))
        for extra_path in self.extra_corpus_paths:
            extra_corpus = CorpusLoader(extra_path).load()
            comments.extend(extra_corpus.comments)
            runs.extend(extra_corpus.runs)
        for extra_payload in self.extra_corpus_payloads:
            extra_corpus = CorpusLoader.load_from_payload({"corpus": extra_payload})
            comments.extend(extra_corpus.comments)
            runs.extend(extra_corpus.runs)
        if self.extra_corpus_paths or self.extra_corpus_payloads:
            storage = "combined"
        return RandomVerificationCorpus(comments=comments, runs=runs, storage=storage)

    def _load_base(self):
        return self.base_corpus.load() if hasattr(self.base_corpus, "load") else self.base_corpus
