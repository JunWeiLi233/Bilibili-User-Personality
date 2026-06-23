from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader


@dataclass(frozen=True)
class Corpus:
    manifest: dict[str, Any]
    comments: list[dict[str, Any]]
    runs: list[dict[str, Any]]


class CorpusPayloadContract:
    """Normalize JS-compatible corpus payload shapes before loading."""

    def __init__(self, payload: dict[str, Any] | None = None):
        self.payload = payload if isinstance(payload, dict) else {}

    def inline_corpus(self) -> Corpus | None:
        corpus_payload = self.payload.get("corpus") if isinstance(self.payload.get("corpus"), dict) else None
        if corpus_payload is None:
            return None
        comments = CorpusLoader._normalize_comments(corpus_payload.get("comments", []))
        runs = CorpusLoader._normalize_runs(corpus_payload.get("runs", []))
        manifest = corpus_payload.get("manifest") if isinstance(corpus_payload.get("manifest"), dict) else {}
        return Corpus(
            manifest={**manifest, "storage": manifest.get("storage") or corpus_payload.get("storage") or "inline"},
            comments=comments,
            runs=runs,
        )

    def path(self, preferred_key: str, default: str) -> str | os.PathLike:
        preferred = self.payload.get(preferred_key)
        if isinstance(preferred, (str, os.PathLike)) and str(preferred).strip():
            return preferred
        fallback = self.payload.get("path")
        if isinstance(fallback, (str, os.PathLike)) and str(fallback).strip():
            return fallback
        return default

    def fallback_manifest(self) -> dict[str, Any] | None:
        fallback = self.payload.get("fallback")
        return fallback if isinstance(fallback, dict) else None


class CorpusLoader:
    """Read corpus JSON in either monolithic or JS split-shard format."""

    def __init__(self, path: str | Path, fallback: dict[str, Any] | None = None):
        self.path = Path(path)
        self.fallback = fallback
        self.reader = JsonContractReader()

    @classmethod
    def load_from_payload(cls, payload: dict[str, Any] | None = None) -> Corpus:
        contract = CorpusPayloadContract(payload)
        inline = contract.inline_corpus()
        if inline is not None:
            return inline
        path = contract.path("corpusPath", "server/data/bilibiliDirectProbeCorpus.json")
        return cls(path, fallback=contract.fallback_manifest()).load()

    def load(self) -> Corpus:
        fallback_manifest = dict(self.fallback or {"version": 1, "comments": [], "runs": []})
        try:
            manifest = self._read_json(self.path, fallback_manifest)
        except FileNotFoundError:
            manifest = fallback_manifest
        if isinstance(manifest, list):
            comments = self._normalize_comments(manifest)
            return Corpus(manifest={"version": 1, "storage": "array", "comments": comments, "runs": []}, comments=comments, runs=[])
        if manifest.get("storage") != "split":
            return Corpus(
                manifest=manifest,
                comments=self._normalize_comments(manifest.get("comments") or []),
                runs=self._normalize_runs(manifest.get("runs") or []),
            )

        comments = (
            self._hydrate_files(manifest.get("commentFiles") or [], "comments")
            if isinstance(manifest.get("commentFiles"), list)
            else self._normalize_comments(manifest.get("comments") or [])
        )
        runs = (
            self._hydrate_files(manifest.get("runFiles") or [], "runs")
            if isinstance(manifest.get("runFiles"), list)
            else self._normalize_runs(manifest.get("runs") or [])
        )
        return Corpus(manifest={**manifest, "comments": comments, "runs": runs}, comments=comments, runs=runs)

    def _hydrate_files(self, files: list[str], key: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for relative_path in self._file_list(files):
            try:
                shard = self._read_json(self.path.parent / relative_path, {})
            except (FileNotFoundError, json.JSONDecodeError):
                continue
            if not isinstance(shard, dict):
                continue
            shard_values = shard.get(key) or []
            if isinstance(shard_values, list):
                values.extend(self._normalize_comments(shard_values) if key == "comments" else self._normalize_runs(shard_values))
        return values

    @staticmethod
    def _normalize_comments(values: Any) -> list[dict[str, Any]]:
        comments: list[dict[str, Any]] = []
        for value in values if isinstance(values, list) else []:
            if isinstance(value, dict):
                comments.append(value)
                continue
            text = str(value or "").strip()
            if text:
                comments.append({"message": text})
        return comments

    @staticmethod
    def _normalize_runs(values: Any) -> list[dict[str, Any]]:
        return [run for run in values if isinstance(run, dict)] if isinstance(values, list) else []

    @staticmethod
    def _file_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if isinstance(item, (str, os.PathLike)) and str(item).strip()]

    @staticmethod
    def _payload_path(payload: dict[str, Any], preferred_key: str, default: str) -> str | os.PathLike:
        return CorpusPayloadContract(payload).path(preferred_key, default)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            raise FileNotFoundError(path)
        return self.reader.read_value(path, fallback)
