from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from python_backend.analysis.audit import CoverageAuditContractSummary
from python_backend.analysis.random_readiness import RandomVerificationReadinessComponentsContract
from python_backend.analysis.random_report import RandomVerificationReportSummary
from python_backend.runtime.readiness import ReadinessGateContract


class RandomVerificationReadinessOutputContract:
    """Build the final random-verification readiness JSON compatibility payload."""

    def __init__(
        self,
        gate_contract: dict[str, Any] | None = None,
        coverage_summary: dict[str, Any] | None = None,
        verification_summary: dict[str, Any] | None = None,
    ):
        self.gate_contract = gate_contract if isinstance(gate_contract, dict) else {}
        self.coverage_summary = coverage_summary if isinstance(coverage_summary, dict) else {}
        self.verification_summary = verification_summary if isinstance(verification_summary, dict) else {}

    def to_json_contract(self) -> dict[str, Any]:
        return {
            **self.gate_contract,
            "coverage": self.coverage_summary,
            "randomVerification": self.verification_summary,
        }


class RandomVerificationReadinessSummaryContract:
    """Normalize raw coverage and random-verification inputs for readiness checks."""

    def __init__(
        self,
        coverage_audit: dict[str, Any] | None = None,
        verification_report: dict[str, Any] | None = None,
    ):
        self.coverage_audit = coverage_audit if isinstance(coverage_audit, dict) else {}
        self.verification_report = verification_report if isinstance(verification_report, dict) else {}

    def coverage_summary(self) -> dict[str, Any]:
        return CoverageAuditContractSummary().summarize(self.coverage_audit)

    def verification_summary(self) -> dict[str, Any]:
        return RandomVerificationReportSummary().summarize(self.verification_report)


@dataclass(frozen=True)
class RandomVerificationReadinessContract:
    """Merge coverage-audit and random-verification evidence into a replacement gate."""

    coverage_audit: dict[str, Any]
    verification_report: dict[str, Any]

    def to_json_contract(self) -> dict[str, Any]:
        summaries = RandomVerificationReadinessSummaryContract(
            coverage_audit=self.coverage_audit,
            verification_report=self.verification_report,
        )
        coverage_summary = summaries.coverage_summary()
        verification_summary = summaries.verification_summary()
        readiness_components = RandomVerificationReadinessComponentsContract(
            coverage_summary=coverage_summary,
            verification_summary=verification_summary,
        ).to_component_collection()
        gate_contract = ReadinessGateContract(
            gates=readiness_components.gates(),
            reasons=readiness_components.blocker_reasons(),
        )
        return RandomVerificationReadinessOutputContract(
            gate_contract=gate_contract.to_json_contract(),
            coverage_summary=coverage_summary,
            verification_summary=verification_summary,
        ).to_json_contract()
