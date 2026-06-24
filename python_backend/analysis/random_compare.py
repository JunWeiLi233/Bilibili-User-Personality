from __future__ import annotations

from typing import Any

from python_backend.analysis.random_report import RandomVerificationReportSummary
from python_backend.analysis.random_sampling import RandomVerificationRunOptions


class RandomVerificationContractComparator:
    """Compare random-verification reports using the JS/Python metric contract."""

    def __init__(self, summary: RandomVerificationReportSummary | None = None):
        self.summary = summary or RandomVerificationReportSummary()

    def compare(self, python_report: dict[str, Any] | None, js_report: dict[str, Any] | None) -> dict[str, Any]:
        python_report = python_report if isinstance(python_report, dict) else {}
        js_report = js_report if isinstance(js_report, dict) else {}
        python_summary = self.summary.summarize(python_report)
        js_summary = self.summary.summarize(js_report)
        metric_keys = tuple(key for key in self.summary.SUMMARY_KEYS if key not in ("sampleSize", "seed"))
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in metric_keys
            if key in js_report and python_summary.get(key) != js_summary.get(key)
        ]
        if "corpus" in js_report and python_summary.get("corpus") != js_summary.get("corpus"):
            mismatches.append({"key": "corpus", "python": python_summary.get("corpus"), "js": js_summary.get("corpus")})
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class RandomVerificationComparisonOptionsContract:
    """Resolve comparator run options from explicit overrides or JS report fields."""

    def __init__(self, sample_size: Any = None, seed: Any = None, js_report: dict[str, Any] | None = None):
        self.sample_size = sample_size
        self.seed = seed
        self.js_report = js_report if isinstance(js_report, dict) else {}

    def options(self) -> RandomVerificationRunOptions:
        return RandomVerificationRunOptions.from_values(
            sample_size=self.sample_size if self.sample_size is not None else self.js_report.get("sampleSize"),
            seed=self.seed if self.seed is not None else self.js_report.get("seed"),
        )
