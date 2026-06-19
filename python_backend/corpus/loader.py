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

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> Corpus:
        manifest = self._read_json(self.path)
        if manifest.get("storage") != "split":
            return Corpus(
                manifest=manifest,
                comments=list(manifest.get("comments") or []),
                runs=list(manifest.get("runs") or []),
            )

        comments = self._hydrate_files(manifest.get("commentFiles") or [], "comments")
        runs = self._hydrate_files(manifest.get("runFiles") or [], "runs")
        return Corpus(manifest={**manifest, "comments": comments, "runs": runs}, comments=comments, runs=runs)

    def _hydrate_files(self, files: list[str], key: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for relative_path in files:
            shard = self._read_json(self.path.parent / relative_path)
            shard_values = shard.get(key) or []
            if isinstance(shard_values, list):
                values.extend(shard_values)
        return values

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)
