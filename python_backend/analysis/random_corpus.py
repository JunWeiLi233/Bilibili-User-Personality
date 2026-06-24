from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from python_backend.corpus.source_breakdown import SourceBreakdownContract


@dataclass(frozen=True)
class RandomVerificationCorpus:
    """Loaded corpus bundle used by random verification reports."""

    comments: list[dict[str, Any]]
    runs: list[dict[str, Any]]
    storage: str

    def as_report_corpus(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "comments": len(self.comments),
            "runs": len(self.runs),
            "storage": self.storage,
        }
        source_breakdown = self._source_breakdown()
        if source_breakdown:
            result["sourceBreakdown"] = source_breakdown
        return result

    def _source_breakdown(self) -> dict[str, dict[str, int]]:
        return SourceBreakdownContract().from_items(comments=self.comments, runs=self.runs)
