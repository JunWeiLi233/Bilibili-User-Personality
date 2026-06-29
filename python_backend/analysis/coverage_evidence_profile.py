from __future__ import annotations

from typing import Any

from python_backend.analysis.coverage_audit_metrics import bool_or as _bool_or, int_or as _int_or


class CoverageEvidenceProfile:
    """Normalize dictionary evidence counts for coverage-audit decisions."""

    def __init__(
        self,
        entry: dict[str, Any],
        require_comment_backed_evidence: bool = False,
        canonical_evidence_count_overrides: dict[tuple[str, str], int] | None = None,
        canonical_coverage_count_overrides: dict[tuple[str, str], int] | None = None,
    ):
        self.entry = entry if isinstance(entry, dict) else {}
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.canonical_evidence_count_overrides = canonical_evidence_count_overrides or {}
        self.canonical_coverage_count_overrides = canonical_coverage_count_overrides or {}

    def evidence_count(self) -> int:
        raw_count = max(0, _int_or(self.entry.get("evidenceCount"), 0))
        override_count = self._canonical_evidence_count_override()
        if override_count is not None:
            return override_count
        unit_count = self.evidence_unit_count()
        if unit_count > 0:
            return unit_count
        return raw_count

    def coverage_evidence_count(self) -> int:
        override_count = self._canonical_coverage_count_override()
        if override_count is not None:
            return override_count
        if self.require_comment_backed_evidence:
            return min(self.evidence_count(), self.comment_backed_evidence_count())
        return self.evidence_count()

    def has_coverage_evidence_source(self) -> bool:
        if self.evidence_count() == 0 or not self._list_field("evidenceSources"):
            return False
        if not self.require_comment_backed_evidence:
            return True
        return self.comment_backed_evidence_count() > 0

    def evidence_unit_count(self) -> int:
        units = set()
        for sample in self._list_field("evidenceSamples"):
            sample_text = str(sample or "").strip()
            if sample_text:
                units.add(f"sample:{sample_text}")
        for source in self._list_field("evidenceSources"):
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

    def comment_backed_evidence_count(self) -> int:
        samples = set()
        has_comment_scan_source = False
        for source in self._list_field("evidenceSources"):
            if not isinstance(source, dict):
                continue
            sample = str(source.get("sample") or "").strip()
            source_text = str(source.get("source") or "").strip()
            is_context = sample.startswith("Bilibili video context:") or sample.startswith("Bilibili public video title:") or "search-discovered video context" in source_text
            if source_text.startswith("Bilibili public ") and "comment scan" in source_text:
                has_comment_scan_source = True
            if sample and not is_context:
                samples.add(sample)
        if has_comment_scan_source:
            for sample in self._list_field("evidenceSamples"):
                sample_text = str(sample or "").strip()
                if sample_text and not sample_text.startswith("Bilibili video context:") and not sample_text.startswith("Bilibili public video title:"):
                    samples.add(sample_text)
        return len(samples)

    def _canonical_evidence_count_override(self) -> int | None:
        family = str(self.entry.get("family") or "unknown")
        term = str(self.entry.get("term") or "").strip()
        return self.canonical_evidence_count_overrides.get((family, term))

    def _canonical_coverage_count_override(self) -> int | None:
        family = str(self.entry.get("family") or "unknown")
        term = str(self.entry.get("term") or "").strip()
        return self.canonical_coverage_count_overrides.get((family, term))

    def _list_field(self, key: str) -> list[Any]:
        value = self.entry.get(key) if isinstance(self.entry, dict) else None
        return value if isinstance(value, list) else []
