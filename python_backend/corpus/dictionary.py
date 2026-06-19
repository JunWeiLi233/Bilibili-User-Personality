from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class KeywordDictionary:
    manifest: dict[str, Any]
    entries: list[dict[str, Any]]


class DictionaryLoader:
    """Read keyword dictionary JSON in monolithic or JS split-shard format."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> KeywordDictionary:
        manifest = self._read_json(self.path)
        if manifest.get("storage") != "split":
            return KeywordDictionary(manifest=manifest, entries=list(manifest.get("entries") or []))

        entries = self._hydrate_entry_files(manifest.get("entryFiles") or {})
        evidence_by_term = self._hydrate_evidence_files(manifest.get("evidenceFiles") or {})
        merged_entries = []
        for entry in entries:
            term = str(entry.get("term") or "").strip()
            evidence = evidence_by_term.get(term, {})
            merged_entries.append({**entry, **evidence})
        return KeywordDictionary(manifest={**manifest, "entries": merged_entries}, entries=merged_entries)

    def _hydrate_entry_files(self, files_by_family: dict[str, list[str]]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for files in files_by_family.values():
            for relative_path in files:
                shard = self._read_json(self.path.parent / relative_path)
                shard_entries = shard.get("entries") or []
                if isinstance(shard_entries, list):
                    entries.extend(shard_entries)
        return entries

    def _hydrate_evidence_files(self, files_by_family: dict[str, list[str]]) -> dict[str, dict[str, Any]]:
        evidence_by_term: dict[str, dict[str, Any]] = {}
        for files in files_by_family.values():
            for relative_path in files:
                shard = self._read_json(self.path.parent / relative_path)
                shard_evidence = shard.get("evidence") or []
                if not isinstance(shard_evidence, list):
                    continue
                for item in shard_evidence:
                    term = str(item.get("term") or "").strip()
                    if term:
                        existing = evidence_by_term.get(term, {"evidenceSamples": [], "evidenceSources": []})
                        evidence_by_term[term] = {
                            "term": term,
                            "evidenceSamples": self._unique([*existing.get("evidenceSamples", []), *(item.get("evidenceSamples") or [])]),
                            "evidenceSources": self._unique_sources([*existing.get("evidenceSources", []), *(item.get("evidenceSources") or [])]),
                        }
        return evidence_by_term

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _unique(values: list[Any]) -> list[Any]:
        seen = set()
        unique_values = []
        for value in values:
            key = str(value)
            if key not in seen:
                seen.add(key)
                unique_values.append(value)
        return unique_values

    @staticmethod
    def _unique_sources(sources: list[Any]) -> list[Any]:
        seen = set()
        unique_sources = []
        for source in sources:
            key = json.dumps(source, sort_keys=True, ensure_ascii=False)
            if key not in seen:
                seen.add(key)
                unique_sources.append(source)
        return unique_sources
