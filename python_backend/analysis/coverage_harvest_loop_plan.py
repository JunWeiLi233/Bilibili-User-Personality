from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


class CoverageHarvestLoopPlanSummary:
    """Shape coverage-harvest loop plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "deepseek",
        "paths",
        "loop",
        "auditOptions",
        "harvestOptions",
        "lists",
        "prune",
        "strict",
        "priorityQueries",
        "initialStopReason",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class CoverageHarvestLoopPlanContractComparator:
    """Compare coverage-harvest loop plans using the JS/Python summary contract."""

    def __init__(self, summary: CoverageHarvestLoopPlanSummary | None = None):
        self.summary = summary or CoverageHarvestLoopPlanSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class CoverageHarvestLoopPlanRunner:
    """Build an auto coverage-harvest loop plan from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import CoverageHarvestLoopPlanner
        payload = self._read_payload()
        return CoverageHarvestLoopPlanner().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class CoverageHarvestLoopPlanPayloadContractComparator:
    """Compare Python coverage-loop plan output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CoverageHarvestLoopPlanSummary()
        self.comparator = CoverageHarvestLoopPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = CoverageHarvestLoopPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class CoverageHarvestLoopCommandSummary:
    """Shape coverage-loop command reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "maxCycles",
        "roundsPerCycle",
        "stopReason",
        "finalOk",
        "cyclesLength",
        "coverageTerms",
        "weakTerms",
        "zeroEvidenceTerms",
        "recommendedQueries",
    )

    def summarize(self, report: dict[str, Any] | None = None) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import _non_negative_int
        report = report if isinstance(report, dict) else {}
        coverage = report.get("finalAudit", {}).get("coverage", {}) if isinstance(report.get("finalAudit"), dict) else {}
        coverage = coverage if isinstance(coverage, dict) else {}
        cycles = report.get("cycles") if isinstance(report.get("cycles"), list) else []
        final_audit = report.get("finalAudit") if isinstance(report.get("finalAudit"), dict) else {}
        recommended_queries = final_audit.get("recommendedQueries") if isinstance(final_audit.get("recommendedQueries"), list) else []
        return {
            "maxCycles": _non_negative_int(report.get("maxCycles"), 0),
            "roundsPerCycle": _non_negative_int(report.get("roundsPerCycle"), 0),
            "stopReason": str(report.get("stopReason") or ""),
            "finalOk": report.get("finalOk") is True,
            "cyclesLength": len(cycles),
            "coverageTerms": _non_negative_int(coverage.get("terms"), 0),
            "weakTerms": _non_negative_int(coverage.get("weakTerms"), 0),
            "zeroEvidenceTerms": _non_negative_int(coverage.get("zeroEvidenceTerms"), 0),
            "recommendedQueries": recommended_queries,
        }


class CoverageHarvestLoopCommandContractComparator:
    """Compare coverage-loop command reports using the stable summary contract."""

    def __init__(self, summary: CoverageHarvestLoopCommandSummary | None = None):
        self.summary = summary or CoverageHarvestLoopCommandSummary()

    def compare(self, python_report: dict[str, Any] | None, js_report: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_report)
        js_summary = self.summary.summarize(js_report)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class CoverageHarvestLoopCommandReportFileComparator:
    """Compare persisted Python and JS coverage-loop command reports."""

    def __init__(self, python_report_path: str | Path, js_report_path: str | Path):
        self.python_report_path = Path(python_report_path)
        self.js_report_path = Path(js_report_path)
        self.comparator = CoverageHarvestLoopCommandContractComparator(CoverageHarvestLoopCommandSummary())

    def compare(self) -> dict[str, Any]:
        return self.comparator.compare(
            safe_read_json_object(self.python_report_path),
            safe_read_json_object(self.js_report_path),
        )


class CoverageHarvestLoopCommandCompareCommandRequest:
    """Parse persisted-report compare argv while keeping coverage-loop comparison in Python."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Compare persisted Python and JS coverage-loop command reports.")
        parser.add_argument("--python-report", required=True)
        parser.add_argument("--js-report", default="")
        parser.add_argument("--compare-js-report", default="")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        js_report_path = args.compare_js_report or args.js_report
        if not js_report_path:
            return {"ok": False, "error": "--js-report or --compare-js-report is required"}
        return CoverageHarvestLoopCommandReportFileComparator(args.python_report, js_report_path).compare()


class CoverageHarvestLoopPlanRequest:
    """Analysis-layer request object for coverage harvest-loop plan JSON contract modes."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return CoverageHarvestLoopPlanPayloadContractComparator(
                self.payload_path,
                self.compare_js_report_path,
            ).compare()
        return CoverageHarvestLoopPlanRunner(self.payload_path).run()


class CoverageHarvestLoopPlanCommandRequest:
    """Analysis-layer command request for coverage harvest-loop plan JSON contract modes."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CoverageHarvestLoopPlanRequest(
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a coverage harvest loop plan from a JSON payload.")
        parser.add_argument("--payload", required=True, help="Path to coverage-loop payload JSON.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible coverage-loop report to compare.")
        return parser
