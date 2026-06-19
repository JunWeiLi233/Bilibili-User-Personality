from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder, CoverageAuditReport
from python_backend.corpus.dictionary import DictionaryLoader


class AuditContractComparator:
    """Compare Python-generated audit metrics against the current JS audit JSON."""

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
    OPTIONAL_COVERAGE_METRIC_KEYS = ("averageEvidence",)

    def __init__(self, dictionary_path: str | Path, js_audit_path: str | Path, strict_total_evidence: bool = False):
        self.dictionary_path = Path(dictionary_path)
        self.js_audit_path = Path(js_audit_path)
        self.strict_total_evidence = strict_total_evidence

    def compare(self) -> dict[str, Any]:
        with self.js_audit_path.open("r", encoding="utf-8-sig") as handle:
            js_audit = json.load(handle)
        target_evidence = int(js_audit.get("targetEvidence") or js_audit.get("coverage", {}).get("targetEvidence") or 3)
        min_coverage_ratio = float(js_audit.get("minCoverageRatio") if js_audit.get("minCoverageRatio") is not None else 1)
        require_complete = js_audit.get("requireComplete") is not False
        require_source_backed = bool(js_audit.get("requireSourceBackedEvidence"))
        require_comment_backed = bool(js_audit.get("requireCommentBackedEvidence"))
        dictionary = DictionaryLoader(self.dictionary_path).load()
        python_audit = CoverageAuditBuilder(
            target_evidence=target_evidence,
            min_coverage_ratio=min_coverage_ratio,
            require_complete=require_complete,
            require_source_backed_evidence=require_source_backed,
            require_comment_backed_evidence=require_comment_backed,
        ).build({"entries": dictionary.entries})
        mismatches = self._metric_mismatches(python_audit, js_audit, self.GATE_METRIC_KEYS)
        mismatches.extend(self._optional_metric_mismatches(python_audit, js_audit, self.COVERAGE_STATUS_KEYS))
        mismatches.extend(self._optional_metric_mismatches(python_audit, js_audit, self.OPTIONAL_COVERAGE_METRIC_KEYS))
        warnings = self._metric_mismatches(python_audit, js_audit, self.WARNING_METRIC_KEYS)
        if "ok" in js_audit:
            python_ok = bool(python_audit.get("ok"))
            js_ok = bool(js_audit.get("ok"))
            if python_ok != js_ok:
                mismatches.append({"key": "ok", "python": python_ok, "js": js_ok})
        if "failureReasons" in js_audit:
            python_reasons = list(python_audit.get("failureReasons") or [])
            js_reasons = list(js_audit.get("failureReasons") or [])
            if python_reasons != js_reasons:
                mismatches.append({"key": "failureReasons", "python": python_reasons, "js": js_reasons})
        if "familyGaps" in js_audit:
            python_family_gaps = list(python_audit.get("familyGaps") or [])
            js_family_gaps = list(js_audit.get("familyGaps") or [])
            if python_family_gaps != js_family_gaps:
                mismatches.append({"key": "familyGaps", "python": python_family_gaps, "js": js_family_gaps})
        if self.strict_total_evidence:
            mismatches.extend(warnings)
            warnings = []
        return {
            "ok": len(mismatches) == 0,
            "mismatches": mismatches,
            "warnings": warnings,
            "python": self._summary(python_audit),
            "js": self._summary(js_audit),
        }

    def _metric_mismatches(self, python_audit: dict[str, Any], js_audit: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        mismatches = []
        python_coverage = python_audit.get("coverage") or {}
        js_coverage = js_audit.get("coverage") or {}
        for key in keys:
            python_value = python_coverage.get(key)
            js_value = js_coverage.get(key)
            if python_value != js_value:
                mismatches.append({"key": key, "python": python_value, "js": js_value})
        return mismatches

    def _optional_metric_mismatches(self, python_audit: dict[str, Any], js_audit: dict[str, Any], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        mismatches = []
        python_coverage = python_audit.get("coverage") or {}
        js_coverage = js_audit.get("coverage") or {}
        for key in keys:
            if key not in js_coverage:
                continue
            python_value = python_coverage.get(key)
            js_value = js_coverage.get(key)
            if python_value != js_value:
                mismatches.append({"key": key, "python": python_value, "js": js_value})
        return mismatches

    def _summary(self, audit: dict[str, Any]) -> dict[str, Any]:
        report = CoverageAuditReport.from_json(audit)
        coverage = audit.get("coverage") or {}
        return {
            "ok": report.ok,
            "targetEvidence": report.target_evidence,
            "coverage": {
                key: coverage.get(key)
                for key in (*self.COVERAGE_STATUS_KEYS, *self.GATE_METRIC_KEYS, *self.OPTIONAL_COVERAGE_METRIC_KEYS, *self.WARNING_METRIC_KEYS)
            },
            "failureReasons": list(audit.get("failureReasons") or []),
            "familyGaps": list(audit.get("familyGaps") or []),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Python coverage-audit metrics against the current JS audit report.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--js-audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--strict-total-evidence", action="store_true")
    args = parser.parse_args()
    result = AuditContractComparator(args.dictionary, args.js_audit, strict_total_evidence=args.strict_total_evidence).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
