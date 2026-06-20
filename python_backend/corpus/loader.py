from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Corpus:
    manifest: dict[str, Any]
    comments: list[dict[str, Any]]
    runs: list[dict[str, Any]]


class CorpusLoader:
    """Read corpus JSON in either monolithic or JS split-shard format."""

    def __init__(self, path: str | Path, fallback: dict[str, Any] | None = None):
        self.path = Path(path)
        self.fallback = fallback

    @classmethod
    def load_from_payload(cls, payload: dict[str, Any] | None = None) -> Corpus:
        payload = payload if isinstance(payload, dict) else {}
        corpus_payload = payload.get("corpus") if isinstance(payload.get("corpus"), dict) else None
        if corpus_payload is not None:
            comments = cls._normalize_comments(corpus_payload.get("comments", []))
            runs = [run for run in corpus_payload.get("runs", []) if isinstance(run, dict)]
            manifest = corpus_payload.get("manifest") if isinstance(corpus_payload.get("manifest"), dict) else {}
            return Corpus(
                manifest={**manifest, "storage": manifest.get("storage") or corpus_payload.get("storage") or "inline"},
                comments=comments,
                runs=runs,
            )
        path = payload.get("corpusPath", payload.get("path", "server/data/bilibiliDirectProbeCorpus.json"))
        fallback = payload.get("fallback") if isinstance(payload.get("fallback"), dict) else None
        return cls(path, fallback=fallback).load()

    def load(self) -> Corpus:
        try:
            manifest = self._read_json(self.path)
        except FileNotFoundError:
            manifest = dict(self.fallback or {"version": 1, "comments": [], "runs": []})
        if isinstance(manifest, list):
            comments = self._normalize_comments(manifest)
            return Corpus(manifest={"version": 1, "storage": "array", "comments": comments, "runs": []}, comments=comments, runs=[])
        if manifest.get("storage") != "split":
            return Corpus(
                manifest=manifest,
                comments=self._normalize_comments(manifest.get("comments") or []),
                runs=list(manifest.get("runs") or []),
            )

        comments = (
            self._hydrate_files(manifest.get("commentFiles") or [], "comments")
            if isinstance(manifest.get("commentFiles"), list)
            else self._normalize_comments(manifest.get("comments") or [])
        )
        runs = (
            self._hydrate_files(manifest.get("runFiles") or [], "runs")
            if isinstance(manifest.get("runFiles"), list)
            else list(manifest.get("runs") or [])
        )
        return Corpus(manifest={**manifest, "comments": comments, "runs": runs}, comments=comments, runs=runs)

    def _hydrate_files(self, files: list[str], key: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for relative_path in files:
            shard = self._read_json(self.path.parent / relative_path)
            shard_values = shard.get(key) or []
            if isinstance(shard_values, list):
                values.extend(self._normalize_comments(shard_values) if key == "comments" else shard_values)
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
    def _read_json(path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)
