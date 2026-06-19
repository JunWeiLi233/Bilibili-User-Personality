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

    def __init__(self, dictionary_path: str | Path, js_audit_path: str | Path, strict_total_evidence: bool = False):
        self.dictionary_path = Path(dictionary_path)
        self.js_audit_path = Path(js_audit_path)
        self.strict_total_evidence = strict_total_evidence

    def compare(self) -> dict[str, Any]:
        with self.js_audit_path.open("r", encoding="utf-8-sig") as handle:
            js_audit = json.load(handle)
        target_evidence = int(js_audit.get("targetEvidence") or js_audit.get("coverage", {}).get("targetEvidence") or 3)
        require_source_backed = bool(js_audit.get("requireSourceBackedEvidence"))
        dictionary = DictionaryLoader(self.dictionary_path).load()
        python_audit = CoverageAuditBuilder(
            target_evidence=target_evidence,
            require_source_backed_evidence=require_source_backed,
        ).build({"entries": dictionary.entries})
        mismatches = self._metric_mismatches(python_audit, js_audit, self.GATE_METRIC_KEYS)
        warnings = self._metric_mismatches(python_audit, js_audit, self.WARNING_METRIC_KEYS)
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

    def _summary(self, audit: dict[str, Any]) -> dict[str, Any]:
        report = CoverageAuditReport.from_json(audit)
        coverage = audit.get("coverage") or {}
        return {
            "ok": report.ok,
            "targetEvidence": report.target_evidence,
            "coverage": {key: coverage.get(key) for key in (*self.GATE_METRIC_KEYS, *self.WARNING_METRIC_KEYS)},
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
