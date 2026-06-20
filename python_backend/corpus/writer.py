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

    @classmethod
    def write_from_payload(cls, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        from python_backend.corpus.loader import CorpusLoader

        payload = payload if isinstance(payload, dict) else {}
        output_path = Path(str(payload.get("outputPath") or ""))
        if not str(output_path):
            raise ValueError("payload outputPath is required")
        comments = payload.get("comments") if isinstance(payload.get("comments"), list) else []
        runs = payload.get("runs") if isinstance(payload.get("runs"), list) else []
        manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
        writer = cls(output_path, max_shard_bytes=int(payload.get("maxShardBytes") or 64 * 1024))
        writer.write(comments=comments, runs=runs, manifest=manifest)
        loaded = CorpusLoader(output_path).load()
        manifest_summary = CorpusShardWriteSummary().summarize_manifest(loaded.manifest)
        return {
            "ok": True,
            "outputPath": str(output_path),
            "manifest": manifest_summary,
            "comments": len(loaded.comments),
            "runs": len(loaded.runs),
        }

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
        shards = self._split_values(values, key, manifest)
        files: list[str] = []
        for index, shard_values in enumerate(shards, start=1):
            name = f"{file_stem}-{index:04d}.json"
            shard_path = directory / name
            self._write_json(
                shard_path,
                self._build_shard_payload(manifest, index, len(shards), key, shard_values),
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

    def _split_values(self, values: list[dict[str, Any]], key: str, manifest: dict[str, Any]) -> list[list[dict[str, Any]]]:
        if not values:
            return [[]]
        shards: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for value in values:
            candidate = [*current, value]
            if current and self._json_bytes(self._build_shard_payload(manifest, 9999, 9999, key, candidate)) > self.max_shard_bytes:
                shards.append(current)
                current = [value]
            else:
                current = candidate
        if current:
            shards.append(current)
        return shards

    @staticmethod
    def _build_shard_payload(
        manifest: dict[str, Any],
        shard: int,
        shard_count: int,
        key: str,
        values: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "version": manifest.get("version", 1),
            "updatedAt": manifest.get("updatedAt") or None,
            "shard": shard,
            "shardCount": shard_count,
            key: values,
        }

    @staticmethod
    def _json_bytes(payload: dict[str, Any]) -> int:
        return len((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class CorpusShardWriteSummary:
    """Shape split-corpus write results into the JS/Python comparator contract."""

    RESULT_KEYS = ("manifest", "comments", "runs")
    MANIFEST_KEYS = ("version", "updatedAt", "source", "storage", "shardMaxBytes", "commentFiles", "commentCount", "runFiles", "runCount")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}

    def summarize_manifest(self, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
        manifest = manifest if isinstance(manifest, dict) else {}
        return {key: manifest.get(key) for key in self.MANIFEST_KEYS if key in manifest}


class CorpusShardWriteContractComparator:
    """Compare split-corpus write summaries using the JS/Python JSON contract."""

    def __init__(self, summary: CorpusShardWriteSummary | None = None):
        self.summary = summary or CorpusShardWriteSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class CorpusShardWriteRunner:
    """Write a JS-compatible split corpus from a JSON payload file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return CorpusShardWriter.write_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class CorpusShardWritePayloadContractComparator:
    """Compare split-corpus write payload output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CorpusShardWriteSummary()
        self.comparator = CorpusShardWriteContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = CorpusShardWriteRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
