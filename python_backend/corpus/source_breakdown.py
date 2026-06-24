from __future__ import annotations

from typing import Any


class SourceBreakdownContract:
    """Build bounded source-count summaries for corpus JSON compatibility reports."""

    def __init__(self, limit: int = 20):
        self.limit = max(1, int(limit or 20))

    def from_items(self, comments: list[dict[str, Any]] | None = None, runs: list[dict[str, Any]] | None = None) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        comment_counts = self._counts_from_items(comments)
        run_counts = self._counts_from_items(runs)
        if comment_counts:
            result["comments"] = self._cap_counts(comment_counts)
        if run_counts:
            result["runs"] = self._cap_counts(run_counts)
        return result

    def from_source_breakdown(self, source_breakdown: Any) -> dict[str, dict[str, int]]:
        if not isinstance(source_breakdown, dict):
            return {}
        result: dict[str, dict[str, int]] = {}
        for bucket in ("comments", "runs"):
            raw_counts = source_breakdown.get(bucket)
            if not isinstance(raw_counts, dict):
                continue
            counts = self._counts_from_mapping(raw_counts)
            if counts:
                result[bucket] = self._cap_counts(counts)
        return result

    def _counts_from_items(self, items: list[dict[str, Any]] | None = None) -> dict[str, int]:
        counts: dict[str, int] = {}
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source") or item.get("platform") or "").strip()
            if not source:
                continue
            counts[source] = counts.get(source, 0) + 1
        return counts

    def _counts_from_mapping(self, raw_counts: dict[Any, Any]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for source, count in raw_counts.items():
            source_key = str(source or "").strip()
            if not source_key:
                continue
            counts[source_key] = self._non_negative_int(count)
        return counts

    def _cap_counts(self, counts: dict[str, int]) -> dict[str, int]:
        if len(counts) <= self.limit:
            return dict(sorted(counts.items()))
        sorted_counts = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        visible = dict(sorted_counts[: self.limit])
        visible["__other__"] = sum(count for _, count in sorted_counts[self.limit :])
        return visible

    @staticmethod
    def _non_negative_int(value: Any) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0
