from __future__ import annotations

from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_audit_artifacts import _object_list, _string_list
from python_backend.analysis.coverage_audit_metrics import (
    CoverageAuditMetricContract,
    bool_or as _bool_or,
    float_or as _float_or,
    int_or as _int_or,
)
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.runtime.json_contracts import safe_read_json_object


def _object_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _coverage_metric_or_none(coverage: dict[str, Any], key: str) -> Any:
    return CoverageAuditMetricContract(coverage).value(key)


class CoverageAuditContractSummary:
    """Shape coverage-audit reports into the JS/Python comparator summary contract."""

    GATE_METRIC_KEYS = (
        "terms",
        "weakTerms",
        "zeroEvidenceTerms",
        "evidenceDeficit",
        "coverageRatio",
        "sourcedEvidenceTerms",
        "unsourcedEvidenceTerms",
        "totalEvidence",
    )
    WARNING_METRIC_KEYS: tuple[str, ...] = ()
    COVERAGE_STATUS_KEYS = ("complete",)
    OPTIONAL_COVERAGE_METRIC_KEYS = ("targetEvidence", "averageEvidence", "sourceCoverageRatio")

    def summarize(self, audit: dict[str, Any] | None = None) -> dict[str, Any]:
        from python_backend.analysis.audit import CoverageAuditReport
        audit = audit if isinstance(audit, dict) else {}
        report = CoverageAuditReport.from_json(audit)
        coverage = audit.get("coverage") if isinstance(audit.get("coverage"), dict) else {}
        return {
            "ok": report.ok,
            "targetEvidence": report.target_evidence,
            "coverage": {
                key: _coverage_metric_or_none(coverage, key)
                for key in (*self.COVERAGE_STATUS_KEYS, *self.GATE_METRIC_KEYS, *self.OPTIONAL_COVERAGE_METRIC_KEYS, *self.WARNING_METRIC_KEYS)
            },
            "failureReasons": _string_list(audit.get("failureReasons")),
            "familyGaps": _object_list(audit.get("familyGaps")),
        }


class CoverageAuditContractComparator:
    """Compare Python coverage-audit payloads against JS-compatible audit payloads."""

    GATE_METRIC_KEYS = CoverageAuditContractSummary.GATE_METRIC_KEYS
    WARNING_METRIC_KEYS = CoverageAuditContractSummary.WARNING_METRIC_KEYS
    COVERAGE_STATUS_KEYS = CoverageAuditContractSummary.COVERAGE_STATUS_KEYS
    OPTIONAL_COVERAGE_METRIC_KEYS = CoverageAuditContractSummary.OPTIONAL_COVERAGE_METRIC_KEYS

    def __init__(self, strict_total_evidence: bool = False, summary: CoverageAuditContractSummary | None = None):
        self.strict_total_evidence = strict_total_evidence
        self.summary = summary or CoverageAuditContractSummary()

    def builder_from_js_audit(self, js_audit: dict[str, Any]) -> "CoverageAuditBuilder":
        from python_backend.analysis.audit import CoverageAuditBuilder
        js_audit = js_audit if isinstance(js_audit, dict) else {}
        coverage = js_audit.get("coverage") if isinstance(js_audit.get("coverage"), dict) else {}
        return CoverageAuditBuilder(
            target_evidence=_int_or(js_audit.get("targetEvidence") or coverage.get("targetEvidence"), 3),
            min_coverage_ratio=_float_or(js_audit.get("minCoverageRatio"), 1),
            require_complete=js_audit.get("requireComplete", True),
            require_source_backed_evidence=js_audit.get("requireSourceBackedEvidence"),
            require_comment_backed_evidence=js_audit.get("requireCommentBackedEvidence"),
        )

    def compare(self, python_audit: dict[str, Any], js_audit: dict[str, Any]) -> dict[str, Any]:
        python_audit = python_audit if isinstance(python_audit, dict) else {}
        js_audit = js_audit if isinstance(js_audit, dict) else {}
        mismatches = self._metric_mismatches(python_audit, js_audit, self.GATE_METRIC_KEYS)
        mismatches.extend(self._optional_metric_mismatches(python_audit, js_audit, self.COVERAGE_STATUS_KEYS))
        mismatches.extend(self._optional_metric_mismatches(python_audit, js_audit, self.OPTIONAL_COVERAGE_METRIC_KEYS))
        warnings = self._metric_mismatches(python_audit, js_audit, self.WARNING_METRIC_KEYS)
        if "ok" in js_audit:
            python_ok = _bool_or(python_audit.get("ok"), False)
            js_ok = _bool_or(js_audit.get("ok"), False)
            if python_ok != js_ok:
                mismatches.append({"key": "ok", "python": python_ok, "js": js_ok})
        if "failureReasons" in js_audit:
            python_reasons = _string_list(python_audit.get("failureReasons"))
            js_reasons = _string_list(js_audit.get("failureReasons"))
            if python_reasons != js_reasons:
                mismatches.append({"key": "failureReasons", "python": python_reasons, "js": js_reasons})
        if "familyGaps" in js_audit:
            python_family_gaps = _object_list(python_audit.get("familyGaps"))
            js_family_gaps = _object_list(js_audit.get("familyGaps"))
            if python_family_gaps != js_family_gaps:
                mismatches.append({"key": "familyGaps", "python": python_family_gaps, "js": js_family_gaps})
        if self.strict_total_evidence:
            mismatches.extend(warnings)
            warnings = []
        return {
            "ok": len(mismatches) == 0,
            "mismatches": mismatches,
            "warnings": warnings,
            "python": self.summary.summarize(python_audit),
            "js": self.summary.summarize(js_audit),
        }

    def _metric_mismatches(self, python_audit: dict[str, Any], js_audit: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        mismatches = []
        python_coverage = _object_or_empty(python_audit.get("coverage"))
        js_coverage = _object_or_empty(js_audit.get("coverage"))
        for key in keys:
            python_value = _coverage_metric_or_none(python_coverage, key)
            js_value = _coverage_metric_or_none(js_coverage, key)
            if python_value != js_value:
                mismatches.append({"key": key, "python": python_value, "js": js_value})
        return mismatches

    def _optional_metric_mismatches(self, python_audit: dict[str, Any], js_audit: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        mismatches = []
        python_coverage = _object_or_empty(python_audit.get("coverage"))
        js_coverage = _object_or_empty(js_audit.get("coverage"))
        for key in keys:
            if key not in js_coverage:
                continue
            python_value = _coverage_metric_or_none(python_coverage, key)
            js_value = _coverage_metric_or_none(js_coverage, key)
            if python_value != js_value:
                mismatches.append({"key": key, "python": python_value, "js": js_value})
        return mismatches


class CoverageAuditPayloadContractComparator:
    """Compare file-backed Python coverage-audit metrics against the current JS audit JSON."""

    def __init__(self, dictionary_path: str | Path, js_audit_path: str | Path, strict_total_evidence: bool = False):
        self.dictionary_path = Path(dictionary_path)
        self.js_audit_path = Path(js_audit_path)
        self.comparator = CoverageAuditContractComparator(strict_total_evidence=strict_total_evidence)

    def compare(self) -> dict[str, Any]:
        js_audit = safe_read_json_object(self.js_audit_path)
        dictionary = DictionaryLoader(self.dictionary_path).load()
        python_audit = self.comparator.builder_from_js_audit(js_audit).build({"entries": dictionary.entries})
        return self.comparator.compare(python_audit, js_audit)
