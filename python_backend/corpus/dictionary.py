from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader


SUPPORTED_FAMILIES = {"attack", "absolutes", "evidence", "evasion", "cooperation", "correction"}


@dataclass(frozen=True)
class KeywordDictionary:
    manifest: dict[str, Any]
    entries: list[dict[str, Any]]


class DictionaryPayloadContract:
    """Normalize JS-compatible dictionary payload shapes before loading."""

    def __init__(self, payload: dict[str, Any] | None = None):
        self.payload = payload if isinstance(payload, dict) else {}

    def inline_dictionary(self) -> KeywordDictionary | None:
        dictionary_payload = self.payload.get("dictionary") if isinstance(self.payload.get("dictionary"), dict) else None
        if dictionary_payload is None:
            return None
        entries = DictionaryLoader._normalize_entries(dictionary_payload.get("entries", []))
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

    def path(self, preferred_key: str, default: str) -> str | os.PathLike:
        preferred = self.payload.get(preferred_key)
        if isinstance(preferred, (str, os.PathLike)) and str(preferred).strip():
            return preferred
        fallback = self.payload.get("path")
        if isinstance(fallback, (str, os.PathLike)) and str(fallback).strip():
            return fallback
        return default


class DictionaryLoader:
    """Read keyword dictionary JSON in monolithic or JS split-shard format."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.reader = JsonContractReader()

    @classmethod
    def load_from_payload(cls, payload: dict[str, Any] | None = None) -> KeywordDictionary:
        contract = DictionaryPayloadContract(payload)
        inline = contract.inline_dictionary()
        if inline is not None:
            return inline
        path = contract.path("dictionaryPath", "server/data/deepseekKeywordDictionary.json")
        return cls(path).load()

    def load(self) -> KeywordDictionary:
        try:
            manifest = self._read_json(self.path)
        except FileNotFoundError:
            manifest = {"version": 1, "storage": "missing", "updatedAt": None, "entries": [], "families": {}}
            return KeywordDictionary(manifest=manifest, entries=[])
        manifest = manifest if isinstance(manifest, dict) else {}
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

        entry_files = self._dict_field(manifest, "entryFiles")
        evidence_files = self._dict_field(manifest, "evidenceFiles")
        entries = self._hydrate_entry_files(entry_files)
        evidence_by_term = self._hydrate_evidence_files(evidence_files)
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
            "evidenceStorage": "split" if evidence_files else None,
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
                try:
                    shard = self._read_json(self.path.parent / relative_path)
                except (FileNotFoundError, json.JSONDecodeError):
                    continue
                if not isinstance(shard, dict):
                    continue
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
                try:
                    shard = self._read_json(self.path.parent / relative_path)
                except (FileNotFoundError, json.JSONDecodeError):
                    continue
                if not isinstance(shard, dict):
                    continue
                shard_evidence = shard.get("evidence") or []
                if not isinstance(shard_evidence, list):
                    continue
                for item in shard_evidence:
                    if not isinstance(item, dict):
                        continue
                    term = str(item.get("term") or "").strip()
                    if term:
                        existing = evidence_by_term.get(term, {"evidenceSamples": [], "evidenceSources": []})
                        evidence_by_term[term] = {
                            "term": term,
                            "evidenceSamples": self._unique([*self._list_field(existing, "evidenceSamples"), *self._list_field(item, "evidenceSamples")]),
                            "evidenceSources": self._unique_sources([*self._list_field(existing, "evidenceSources"), *self._list_field(item, "evidenceSources")]),
                        }
        return evidence_by_term

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            raise FileNotFoundError(path)
        return self.reader.read_value(path, {})

    @staticmethod
    def _dict_field(value: dict[str, Any], key: str) -> dict[str, Any]:
        field = value.get(key) if isinstance(value, dict) else None
        return field if isinstance(field, dict) else {}

    @staticmethod
    def _file_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if isinstance(item, (str, os.PathLike)) and str(item).strip()]
        if isinstance(value, (str, os.PathLike)) and str(value).strip():
            return [str(value)]
        return []

    @staticmethod
    def _payload_path(payload: dict[str, Any], preferred_key: str, default: str) -> str | os.PathLike:
        return DictionaryPayloadContract(payload).path(preferred_key, default)

    @staticmethod
    def _list_field(value: dict[str, Any], key: str) -> list[Any]:
        field = value.get(key) if isinstance(value, dict) else None
        return field if isinstance(field, list) else []

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
            if not isinstance(source, dict):
                continue
            key = json.dumps(source, sort_keys=True, ensure_ascii=False)
            if key not in seen:
                seen.add(key)
                unique_sources.append(source)
        return unique_sources
