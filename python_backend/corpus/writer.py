from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


class CorpusShardWriter:
    """Write a small split corpus using the same manifest keys as JS."""

    def __init__(self, path: str | Path, max_shard_bytes: int = 64 * 1024):
        self.path = Path(path)
        self.max_shard_bytes = max(1024, int(max_shard_bytes))

    def write(
        self,
        *,
        comments: list[dict[str, Any]],
        runs: list[dict[str, Any]],
        manifest: dict[str, Any] | None = None,
    ) -> None:
        manifest = dict(manifest or {})
        comment_files = self._write_shards(comments, "comments", self._comments_dir(), "comments", manifest)
        run_files = self._write_shards(runs, "runs", self._runs_dir(), "runs", manifest)
        payload = {
            **manifest,
            "version": manifest.get("version", 1),
            "storage": "split",
            "shardMaxBytes": self.max_shard_bytes,
            "commentFiles": comment_files,
            "commentCount": len(comments),
            "runFiles": run_files,
            "runCount": len(runs),
        }
        self._write_json(self.path, payload)
        self._remove_stale_shards(self._comments_dir(), comment_files, r"comments-\d{4}\.json")
        self._remove_stale_shards(self._runs_dir(), run_files, r"runs-\d{4}\.json")

    def _comments_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.comments"

    def _runs_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.runs"

    def _write_shards(
        self,
        values: list[dict[str, Any]],
        file_stem: str,
        directory: Path,
        key: str,
        manifest: dict[str, Any],
    ) -> list[str]:
        directory.mkdir(parents=True, exist_ok=True)
        shards = self._split_values(values, key)
        files: list[str] = []
        for index, shard_values in enumerate(shards, start=1):
            name = f"{file_stem}-{index:04d}.json"
            shard_path = directory / name
            self._write_json(
                shard_path,
                {
                    "version": manifest.get("version", 1),
                    "updatedAt": manifest.get("updatedAt") or None,
                    "shard": index,
                    "shardCount": len(shards),
                    key: shard_values,
                },
            )
            files.append(f"{directory.name}/{name}")
        return files

    def _remove_stale_shards(self, directory: Path, kept_files: list[str], pattern: str) -> None:
        kept_names = {Path(path).name for path in kept_files}
        regex = re.compile(pattern, re.IGNORECASE)
        if not directory.exists():
            return
        for path in directory.iterdir():
            if path.is_file() and regex.fullmatch(path.name) and path.name not in kept_names:
                path.unlink()

    def _split_values(self, values: list[dict[str, Any]], key: str) -> list[list[dict[str, Any]]]:
        if not values:
            return [[]]
        shards: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for value in values:
            candidate = [*current, value]
            if current and len(json.dumps({key: candidate}, ensure_ascii=False, indent=2).encode("utf-8")) > self.max_shard_bytes:
                shards.append(current)
                current = [value]
            else:
                current = candidate
        if current:
            shards.append(current)
        return shards

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
