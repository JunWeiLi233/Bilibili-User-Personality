from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SUPPORTED_FAMILIES = {"attack", "absolutes", "evidence", "evasion", "cooperation", "correction"}


@dataclass(frozen=True)
class KeywordDictionary:
    manifest: dict[str, Any]
    entries: list[dict[str, Any]]


class DictionaryLoader:
    """Read keyword dictionary JSON in monolithic or JS split-shard format."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    @classmethod
    def load_from_payload(cls, payload: dict[str, Any] | None = None) -> KeywordDictionary:
        payload = payload if isinstance(payload, dict) else {}
        dictionary_payload = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else None
        if dictionary_payload is not None:
            entries = cls._normalize_entries(dictionary_payload.get("entries", []))
            return KeywordDictionary(
                manifest={
                    "version": dictionary_payload.get("version", 1),
                    "storage": dictionary_payload.get("storage") or "inline",
                    "updatedAt": dictionary_payload.get("updatedAt") or None,
                    "entries": entries,
                    "families": dictionary_payload.get("families") or {},
                },
                entries=entries,
            )
        path = payload.get("dictionaryPath", payload.get("path", "server/data/deepseekKeywordDictionary.json"))
        return cls(path).load()

    def load(self) -> KeywordDictionary:
        try:
            manifest = self._read_json(self.path)
        except FileNotFoundError:
            manifest = {"version": 1, "storage": "missing", "updatedAt": None, "entries": [], "families": {}}
            return KeywordDictionary(manifest=manifest, entries=[])
        if manifest.get("storage") != "split":
            entries = self._normalize_entries(manifest.get("entries") or [])
            normalized = {
                "version": manifest.get("version", 1),
                "storage": "monolith",
                "updatedAt": manifest.get("updatedAt") or None,
                "entries": entries,
                "families": manifest.get("families") or {},
            }
            return KeywordDictionary(manifest=normalized, entries=entries)

        entries = self._hydrate_entry_files(manifest.get("entryFiles") or {})
        evidence_by_term = self._hydrate_evidence_files(manifest.get("evidenceFiles") or {})
        merged_entries = []
        for entry in entries:
            term = str(entry.get("term") or "").strip()
            evidence = evidence_by_term.get(term, {})
            merged_entries.append({**entry, **evidence})
        normalized = {
            "version": manifest.get("version", 1),
            "storage": "split",
            "shardSize": manifest.get("shardSize") or None,
            "shardMaxBytes": manifest.get("shardMaxBytes") or None,
            "evidenceStorage": "split" if manifest.get("evidenceFiles") else None,
            "updatedAt": manifest.get("updatedAt") or None,
            "entries": merged_entries,
            "families": manifest.get("families") or {},
        }
        return KeywordDictionary(manifest=normalized, entries=merged_entries)

    def _hydrate_entry_files(self, files_by_family: dict[str, list[str]]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for family, file_spec in files_by_family.items():
            if family not in SUPPORTED_FAMILIES:
                continue
            for relative_path in self._file_list(file_spec):
                shard = self._read_json(self.path.parent / relative_path)
                shard_entries = shard.get("entries") or []
                if isinstance(shard_entries, list):
                    entries.extend({**entry, "family": entry.get("family") or family} for entry in self._normalize_entries(shard_entries))
        return entries

    def _hydrate_evidence_files(self, files_by_family: dict[str, list[str]]) -> dict[str, dict[str, Any]]:
        evidence_by_term: dict[str, dict[str, Any]] = {}
        for family, file_spec in files_by_family.items():
            if family not in SUPPORTED_FAMILIES:
                continue
            for relative_path in self._file_list(file_spec):
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
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    @staticmethod
    def _file_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if item]
        if value:
            return [str(value)]
        return []

    @staticmethod
    def _normalize_entries(values: Any) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for value in values if isinstance(values, list) else []:
            if isinstance(value, dict):
                entries.append(value)
                continue
            term = str(value or "").strip()
            if term:
                entries.append({"term": term})
        return entries

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
