from __future__ import annotations

from typing import Any

from python_backend.runtime.readiness import ReadinessBlockerDetailsContract, ReadinessComponentCollectionContract


def _int_or(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _non_negative_int(value: Any, fallback: int = 0) -> int:
    return max(0, _int_or(value, fallback))


class RandomVerificationSelectionReadinessContract:
    """Own readiness gates derived from random-verification selection metadata."""

    REASONS = {
        "randomVerificationSelectionConsistent": "random verification selected count does not match sampled comments",
        "randomVerificationSelectionPossible": "random verification selected more comments than requested or eligible",
        "randomVerificationSelectionOptionsMatch": "random verification selection options do not match report options",
    }

    def __init__(self, verification_summary: dict[str, Any] | None = None):
        self.verification_summary = verification_summary if isinstance(verification_summary, dict) else {}

    def gates(self) -> list[dict[str, Any]]:
        return [
            {
                "gate": "randomVerificationSelectionConsistent",
                "ok": self._selection_consistent(),
            },
            {
                "gate": "randomVerificationSelectionPossible",
                "ok": self._selection_possible(),
            },
            {
                "gate": "randomVerificationSelectionOptionsMatch",
                "ok": self._selection_options_match(),
            },
        ]

    def blocker_reasons(self) -> dict[str, str]:
        return self.REASONS

    def blocker_details(self) -> list[dict[str, str]]:
        return ReadinessBlockerDetailsContract(self.REASONS).from_gates(self.gates())

    def _selection_summary(self) -> dict[str, Any]:
        selection_summary = self.verification_summary.get("selectionSummary")
        return selection_summary if isinstance(selection_summary, dict) else {}

    def _selection_consistent(self) -> bool:
        selection_summary = self._selection_summary()
        if not selection_summary:
            return True
        return _non_negative_int(selection_summary.get("selectedComments"), 0) == _non_negative_int(
            self.verification_summary.get("sampled"),
            0,
        )

    def _selection_possible(self) -> bool:
        selection_summary = self._selection_summary()
        if not selection_summary:
            return True
        selected_comments = _non_negative_int(selection_summary.get("selectedComments"), 0)
        return selected_comments <= min(
            _non_negative_int(selection_summary.get("eligibleComments"), 0),
            _non_negative_int(selection_summary.get("requestedSampleSize"), 0),
        )

    def _selection_options_match(self) -> bool:
        selection_summary = self._selection_summary()
        if not selection_summary:
            return True
        return (
            _non_negative_int(selection_summary.get("requestedSampleSize"), 0)
            == _non_negative_int(self.verification_summary.get("sampleSize"), 50)
            and _int_or(selection_summary.get("seed"), 1) == _int_or(self.verification_summary.get("seed"), 1)
        )


class RandomVerificationSampleReadinessContract:
    """Own readiness gates derived from random-verification sample results."""

    REASONS = {
        "randomVerificationSampled": "random verification sampled no comments",
        "randomVerificationNoUncovered": "random verification still has uncovered samples",
    }

    def __init__(self, verification_summary: dict[str, Any] | None = None):
        self.verification_summary = verification_summary if isinstance(verification_summary, dict) else {}

    def gates(self) -> list[dict[str, Any]]:
        return [
            {"gate": "randomVerificationSampled", "ok": self._sampled()},
            {"gate": "randomVerificationNoUncovered", "ok": self._uncovered() == 0},
        ]

    def blocker_reasons(self) -> dict[str, str]:
        return self.REASONS

    def blocker_details(self) -> list[dict[str, str]]:
        return ReadinessBlockerDetailsContract(self.REASONS).from_gates(self.gates())

    def _sampled(self) -> bool:
        return _non_negative_int(self.verification_summary.get("sampled"), 0) > 0

    def _uncovered(self) -> int:
        return _non_negative_int(self.verification_summary.get("uncovered"), 0)


class CoverageAuditReadinessContract:
    """Own readiness gates derived from coverage-audit results."""

    REASONS = {
        "coverageAuditComplete": "coverage audit is not complete",
    }

    def __init__(self, coverage_summary: dict[str, Any] | None = None):
        self.coverage_summary = coverage_summary if isinstance(coverage_summary, dict) else {}

    def gates(self) -> list[dict[str, Any]]:
        return [{"gate": "coverageAuditComplete", "ok": self._coverage_complete()}]

    def blocker_reasons(self) -> dict[str, str]:
        return self.REASONS

    def blocker_details(self) -> list[dict[str, str]]:
        return ReadinessBlockerDetailsContract(self.REASONS).from_gates(self.gates())

    def _coverage_complete(self) -> bool:
        coverage = self.coverage_summary.get("coverage")
        coverage = coverage if isinstance(coverage, dict) else {}
        return bool(self.coverage_summary.get("ok")) and coverage.get("complete") is True


class RandomVerificationReadinessComponentsContract:
    """Build the ordered readiness component collection for random-verification replacement."""

    def __init__(
        self,
        coverage_summary: dict[str, Any] | None = None,
        verification_summary: dict[str, Any] | None = None,
    ):
        self.coverage_summary = coverage_summary if isinstance(coverage_summary, dict) else {}
        self.verification_summary = verification_summary if isinstance(verification_summary, dict) else {}

    def to_component_collection(self) -> ReadinessComponentCollectionContract:
        return ReadinessComponentCollectionContract(
            [
                CoverageAuditReadinessContract(self.coverage_summary),
                RandomVerificationSampleReadinessContract(self.verification_summary),
                RandomVerificationSelectionReadinessContract(self.verification_summary),
            ]
        )
