from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader


SUPPORTED_FAMILIES = {"attack", "absolutes", "evidence", "evasion", "cooperation", "correction"}
SUPPORTED_FAMILY_ORDER = ["attack", "absolutes", "evidence", "evasion", "cooperation", "correction"]


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


class DictionaryManifestContract:
    """Build normalized keyword dictionary manifests for JS-compatible loaders."""

    def __init__(self, manifest: dict[str, Any] | None = None):
        self.manifest = manifest if isinstance(manifest, dict) else {}

    def monolith(self, entries: Any) -> dict[str, Any]:
        normalized_entries = DictionaryLoader._normalize_entries(entries)
        return {
            "version": self.manifest.get("version", 1),
            "storage": "monolith",
            "updatedAt": self.manifest.get("updatedAt") or None,
            "entries": normalized_entries,
            "families": self.manifest.get("families") or {},
        }

    def split(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        evidence_files = DictionaryLoader._dict_field(self.manifest, "evidenceFiles")
        return {
            "version": self.manifest.get("version", 1),
            "storage": "split",
            "shardSize": self.manifest.get("shardSize") or None,
            "shardMaxBytes": self.manifest.get("shardMaxBytes") or None,
            "evidenceStorage": "split" if evidence_files else None,
            "updatedAt": self.manifest.get("updatedAt") or None,
            "entryFiles": DictionaryLoader._dict_field(self.manifest, "entryFiles"),
            "evidenceFiles": evidence_files,
            "entries": entries,
            "families": self.manifest.get("families") or {},
        }


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
            normalized = DictionaryManifestContract(manifest).monolith(manifest.get("entries") or [])
            entries = normalized["entries"]
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
        merged_entries = [self._normalize_loaded_entry(entry) for entry in merged_entries]
        normalized = DictionaryManifestContract(manifest).split(merged_entries)
        return KeywordDictionary(manifest=normalized, entries=normalized["entries"])

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

    def _normalize_loaded_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        samples = self._unique([str(sample).strip() for sample in self._list_field(entry, "evidenceSamples") if str(sample).strip()])
        sources = self._unique_sources(self._list_field(entry, "evidenceSources"))
        raw_count = self._int_value(entry.get("evidenceCount"), 0)
        if raw_count <= 0 and not samples and not sources:
            return entry
        evidence_count = self._canonical_evidence_count(raw_count, samples, sources)
        return {**entry, "evidenceCount": evidence_count, "evidenceSamples": samples, "evidenceSources": sources}

    @staticmethod
    def _canonical_evidence_count(raw_count: int, samples: list[Any], sources: list[Any]) -> int:
        raw_count = max(0, raw_count)
        unit_count = DictionaryLoader._evidence_unit_count(samples, sources)
        if raw_count > 0 and unit_count > 0:
            return min(raw_count, unit_count)
        return raw_count

    @staticmethod
    def _evidence_unit_count(samples: list[Any], sources: list[Any]) -> int:
        units = set()
        for sample in samples:
            clean = str(sample or "").strip()
            if clean:
                units.add(f"sample:{clean}")
        for source in sources:
            if not isinstance(source, dict):
                continue
            sample = str(source.get("sample") or "").strip()
            if sample:
                units.add(f"sample:{sample}")
                continue
            source_text = str(source.get("source") or "").strip()
            uid = str(source.get("uid") or "").strip()
            if source_text or uid:
                units.add(f"source:{source_text}\n{uid}")
        return len(units)

    @staticmethod
    def _int_value(value: Any, fallback: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

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


class DictionaryMergeWriter:
    """Write and merge JS-compatible split keyword dictionaries."""

    def __init__(self, path: str | Path, *, generated_at: str | None = None, max_shard_bytes: Any = 64 * 1024):
        self.path = Path(path)
        self.generated_at = generated_at
        self.max_shard_bytes = max(1024, self._int_value(max_shard_bytes, 64 * 1024))

    def merge_entries(self, entries: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        current = DictionaryLoader(self.path).load()
        before = len(current.entries)
        merged = self._merge_entry_lists(current.entries, entries or [])
        self.write(merged, version=current.manifest.get("version", 1))
        return {"ok": True, "before": before, "after": len(merged), "entries": len(entries or [])}

    def write(self, entries: list[dict[str, Any]] | None = None, *, version: Any = 1) -> dict[str, Any]:
        entries = [self._normalize_entry(entry) for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []
        entries = sorted(entries, key=lambda entry: (SUPPORTED_FAMILY_ORDER.index(entry["family"]) if entry["family"] in SUPPORTED_FAMILY_ORDER else 999, entry["term"]))
        updated_at = self.generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        entry_files: dict[str, list[str]] = {}
        evidence_files: dict[str, list[str]] = {}
        for family in SUPPORTED_FAMILY_ORDER:
            family_entries = [entry for entry in entries if entry.get("family") == family]
            entry_shards = self._split_payloads(family_entries, lambda shard, count, values: self._entry_shard_payload(version, updated_at, family, shard, count, values))
            evidence_values = [self._evidence_payload_value(entry) for entry in family_entries if self._has_evidence(entry)]
            evidence_shards = self._split_payloads(evidence_values, lambda shard, count, values: self._evidence_shard_payload(version, updated_at, family, shard, count, values))
            entry_files[family] = self._write_family_shards(self._entries_dir(), family, "entries", entry_shards)
            evidence_files[family] = self._write_family_shards(self._evidence_dir(), family, "evidence", evidence_shards)
        manifest = {
            "version": self._int_value(version, 1),
            "storage": "split",
            "updatedAt": updated_at,
            "shardMaxBytes": self.max_shard_bytes,
            "entryFiles": entry_files,
            "evidenceFiles": evidence_files,
        }
        self._write_json(self.path, manifest)
        self._remove_stale(self._entries_dir(), entry_files)
        self._remove_stale(self._evidence_dir(), evidence_files)
        return {"ok": True, "entries": len(entries), "manifest": manifest}

    def _merge_entry_lists(self, current_entries: list[dict[str, Any]], incoming_entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for entry in [*current_entries, *incoming_entries]:
            normalized = self._normalize_entry(entry)
            term = normalized["term"]
            if not term:
                continue
            merged[term] = self._merge_entry(merged.get(term), normalized)
        return list(merged.values())

    def _merge_entry(self, existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
        if not existing:
            return incoming
        samples = DictionaryLoader._unique([*DictionaryLoader._list_field(existing, "evidenceSamples"), *DictionaryLoader._list_field(incoming, "evidenceSamples")])
        sources = DictionaryLoader._unique_sources([*DictionaryLoader._list_field(existing, "evidenceSources"), *DictionaryLoader._list_field(incoming, "evidenceSources")])
        evidence_count = max(self._int_value(existing.get("evidenceCount"), 0), self._int_value(incoming.get("evidenceCount"), 0), len(samples), len(sources))
        return {
            **existing,
            **{key: value for key, value in incoming.items() if value not in ("", None, [], {})},
            "evidenceCount": evidence_count,
            "evidenceSamples": samples,
            "evidenceSources": sources,
        }

    @staticmethod
    def _canonical_evidence_count(raw_count: int, samples: list[Any], sources: list[Any]) -> int:
        raw_count = max(0, raw_count)
        unit_count = DictionaryLoader._evidence_unit_count(samples, sources)
        if raw_count > 0 and unit_count > 0:
            return min(raw_count, unit_count)
        return raw_count

    @staticmethod
    def _evidence_unit_count(samples: list[Any], sources: list[Any]) -> int:
        units = set()
        for sample in samples:
            clean = str(sample or "").strip()
            if clean:
                units.add(f"sample:{clean}")
        for source in sources:
            if not isinstance(source, dict):
                continue
            sample = str(source.get("sample") or "").strip()
            if sample:
                units.add(f"sample:{sample}")
                continue
            source_text = str(source.get("source") or "").strip()
            uid = str(source.get("uid") or "").strip()
            if source_text or uid:
                units.add(f"source:{source_text}\n{uid}")
        return len(units)

    def _normalize_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        term = str(entry.get("term") or "").strip()
        family = str(entry.get("family") or "attack").strip()
        if family not in SUPPORTED_FAMILIES:
            family = "attack"
        samples = DictionaryLoader._unique([str(sample).strip() for sample in DictionaryLoader._list_field(entry, "evidenceSamples") if str(sample).strip()])
        evidence = DictionaryLoader._unique([str(sample).strip() for sample in DictionaryLoader._list_field(entry, "evidence") if str(sample).strip()])
        samples = DictionaryLoader._unique([*samples, *evidence])
        sources = DictionaryLoader._unique_sources(DictionaryLoader._list_field(entry, "evidenceSources"))
        evidence_count = max(self._int_value(entry.get("evidenceCount"), 0), len(samples), len(sources))
        return {
            **entry,
            "term": term,
            "family": family,
            "evidenceCount": evidence_count,
            "evidenceSamples": samples,
            "evidenceSources": sources,
        }

    def _split_payloads(self, values: list[dict[str, Any]], payload_builder) -> list[dict[str, Any]]:
        if not values:
            return []
        shards: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for value in values:
            candidate = [*current, value]
            if current and self._json_bytes(payload_builder(999, 999, candidate)) > self.max_shard_bytes:
                shards.append(current)
                current = [value]
            else:
                current = candidate
        if current:
            shards.append(current)
        return [payload_builder(index, len(shards), shard_values) for index, shard_values in enumerate(shards, start=1)]

    def _write_family_shards(self, directory: Path, family: str, stem: str, payloads: list[dict[str, Any]]) -> list[str]:
        directory.mkdir(parents=True, exist_ok=True)
        files = []
        for index, payload in enumerate(payloads, start=1):
            name = f"{family}-{index:03d}.json"
            self._write_json(directory / name, payload)
            files.append(f"{directory.name}/{name}")
        return files

    def _entry_shard_payload(self, version: Any, updated_at: str, family: str, shard: int, shard_count: int, entries: list[dict[str, Any]]) -> dict[str, Any]:
        stripped_entries = []
        for entry in entries:
            stripped_entries.append({key: value for key, value in entry.items() if key not in {"evidence", "evidenceSamples", "evidenceSources"}})
        return {
            "version": self._int_value(version, 1),
            "updatedAt": updated_at,
            "family": family,
            "shard": shard,
            "shardCount": shard_count,
            "entries": stripped_entries,
        }

    def _evidence_shard_payload(self, version: Any, updated_at: str, family: str, shard: int, shard_count: int, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "version": self._int_value(version, 1),
            "updatedAt": updated_at,
            "family": family,
            "shard": shard,
            "shardCount": shard_count,
            "evidence": evidence,
        }

    def _evidence_payload_value(self, entry: dict[str, Any]) -> dict[str, Any]:
        return {
            "term": entry.get("term"),
            "evidenceSamples": DictionaryLoader._list_field(entry, "evidenceSamples"),
            "evidenceSources": DictionaryLoader._list_field(entry, "evidenceSources"),
        }

    @staticmethod
    def _has_evidence(entry: dict[str, Any]) -> bool:
        return bool(DictionaryLoader._list_field(entry, "evidenceSamples") or DictionaryLoader._list_field(entry, "evidenceSources"))

    def _entries_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.entries"

    def _evidence_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.evidence"

    def _remove_stale(self, directory: Path, file_map: dict[str, list[str]]) -> None:
        kept = {Path(path).name for paths in file_map.values() for path in paths}
        if not directory.exists():
            return
        for path in directory.iterdir():
            if path.is_file() and path.name.endswith(".json") and path.name not in kept:
                path.unlink()

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _json_bytes(payload: dict[str, Any]) -> int:
        return len((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    @staticmethod
    def _int_value(value: Any, fallback: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback
