from __future__ import annotations

from typing import Any

from python_backend.corpus.source_breakdown import SourceBreakdownContract


def _int_or(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _non_negative_int(value: Any, fallback: int = 0) -> int:
    return max(0, _int_or(value, fallback))


class RandomVerificationReportSummary:
    """Shape random-verification reports into the JS/Python comparator summary contract."""

    SUMMARY_KEYS = ("sampleSize", "seed", "sampled", "keywordHits", "neutral", "uncovered", "selectionSummary")
    CORPUS_KEYS = ("comments", "runs", "storage", "sourceBreakdown")

    def summarize(self, report: dict[str, Any] | None = None) -> dict[str, Any]:
        report = report if isinstance(report, dict) else {}
        summary: dict[str, Any] = {
            "sampleSize": _non_negative_int(report.get("sampleSize"), 50),
            "seed": _int_or(report.get("seed"), 1),
            "sampled": _non_negative_int(report.get("sampled"), 0),
            "keywordHits": _non_negative_int(report.get("keywordHits"), 0),
            "neutral": _non_negative_int(report.get("neutral"), 0),
            "uncovered": _non_negative_int(report.get("uncovered"), 0),
        }
        corpus = self._summarize_corpus(report.get("corpus"))
        if corpus:
            summary["corpus"] = corpus
        selection_summary = self._summarize_selection_summary(report.get("selectionSummary"))
        if selection_summary:
            summary["selectionSummary"] = selection_summary
        return summary

    def _summarize_selection_summary(self, selection_summary: Any) -> dict[str, int]:
        if not isinstance(selection_summary, dict):
            return {}
        return {
            "requestedSampleSize": _non_negative_int(selection_summary.get("requestedSampleSize"), 0),
            "eligibleComments": _non_negative_int(selection_summary.get("eligibleComments"), 0),
            "selectedComments": _non_negative_int(selection_summary.get("selectedComments"), 0),
            "seed": _int_or(selection_summary.get("seed"), 1),
        }

    def _summarize_corpus(self, corpus: Any) -> dict[str, Any]:
        if not isinstance(corpus, dict):
            return {}
        result: dict[str, Any] = {}
        if "comments" in corpus:
            result["comments"] = _non_negative_int(corpus.get("comments"), 0)
        if "runs" in corpus:
            result["runs"] = _non_negative_int(corpus.get("runs"), 0)
        if "storage" in corpus:
            result["storage"] = str(corpus.get("storage") or "")
        source_breakdown = self._normalize_source_breakdown(corpus.get("sourceBreakdown"))
        if source_breakdown:
            result["sourceBreakdown"] = source_breakdown
        return result

    def _normalize_source_breakdown(self, source_breakdown: Any) -> dict[str, dict[str, int]]:
        return SourceBreakdownContract().from_source_breakdown(source_breakdown)
