from __future__ import annotations

from typing import Any


def int_or(value: Any, fallback: int) -> int:
    try:
        return int(value if value is not None else fallback)
    except (TypeError, ValueError):
        return fallback


def float_or(value: Any, fallback: float) -> float:
    try:
        return float(value if value is not None else fallback)
    except (TypeError, ValueError):
        return fallback


def bool_or(value: Any, fallback: bool) -> bool:
    return value if isinstance(value, bool) else fallback


class CoverageAuditMetricContract:
    """Normalize coverage-audit metric values from JS-compatible JSON reports."""

    FLOAT_KEYS = frozenset(("coverageRatio", "averageEvidence", "sourceCoverageRatio"))

    def __init__(self, coverage: dict[str, Any] | None = None):
        self.coverage = coverage if isinstance(coverage, dict) else {}

    def value(self, key: str) -> Any:
        if key not in self.coverage:
            return None
        if key == "complete":
            return bool_or(self.coverage.get(key), False)
        if key in self.FLOAT_KEYS:
            return float_or(self.coverage.get(key), 0)
        return int_or(self.coverage.get(key), 0)


class CoverageAuditGateContract:
    """Own the JS-compatible coverage audit pass/fail contract."""

    def __init__(
        self,
        coverage: dict[str, Any] | None = None,
        target_evidence: int = 3,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
    ):
        self.coverage = CoverageAuditMetricContract(coverage)
        self.target_evidence = max(1, int_or(target_evidence, 3))
        self.min_coverage_ratio = min(1, max(0, float_or(min_coverage_ratio, 1)))
        self.require_complete = bool_or(require_complete, True)
        self.require_source_backed_evidence = bool_or(require_source_backed_evidence, False)

    def ok(self) -> bool:
        return len(self.failure_reasons()) == 0

    def failure_reasons(self) -> list[str]:
        reasons = []
        coverage_ratio = self.coverage.value("coverageRatio")
        if coverage_ratio < self.min_coverage_ratio:
            reasons.append(f"coverage ratio {coverage_ratio} is below {self.min_coverage_ratio}")
        if self.require_complete and not self.coverage.value("complete"):
            weak_terms = self.coverage.value("weakTerms")
            reasons.append(f"{weak_terms} term(s) are below {self.target_evidence} evidence hit(s)")
        if self.require_source_backed_evidence and self.coverage.value("unsourcedEvidenceTerms") > 0:
            unsourced_terms = self.coverage.value("unsourcedEvidenceTerms")
            reasons.append(f"{unsourced_terms} evidence-backed term(s) are missing Bilibili source metadata")
        return reasons


class CoverageAuditActionSummaryContract:
    """Summarize JS-compatible coverage audit actions by action key."""

    def __init__(self, actions: list[Any] | None = None):
        self.actions = actions if isinstance(actions, list) else []

    def summary(self) -> dict[str, int]:
        summary: dict[str, int] = {}
        for action in self.actions:
            if not isinstance(action, dict):
                continue
            key = str(action.get("action") or "none")
            summary[key] = summary.get(key, 0) + 1
        return summary
