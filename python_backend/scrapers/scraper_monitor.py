from __future__ import annotations

import math
from typing import Any


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed


class ScraperMonitorPipelinePayloadPlanner:
    """Plan UID pipeline progress filenames for scraper monitor reads."""

    def progress_files(self, *, total_start: int = 1, total_end: int = 100000, workers: int = 5) -> list[str]:
        total_start = int(total_start)
        total_end = int(total_end)
        workers = max(1, int(workers))
        total_expected = max(0, total_end - total_start + 1)
        chunk_size = math.ceil(total_expected / workers) if total_expected else 0
        progress_files = []
        for worker_index in range(workers):
            start = total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, total_end)
            if start > total_end:
                break
            progress_files.append(f"uid-pipeline-{start}-{end}.json")
        return progress_files


class ScraperMonitorReporter:
    """Build compact discovery and UID pipeline monitor summaries from JSON payloads."""

    def __init__(self, *, pipeline_rate_per_minute: int = 50):
        self.pipeline_rate_per_minute = max(1, int(pipeline_rate_per_minute))

    def build_report(
        self,
        *,
        discovery_progress: Any,
        pipeline_report: Any,
        pipeline_progress_payloads: list[Any] | None = None,
    ) -> dict[str, Any]:
        discovery = self._discovery_summary(discovery_progress)
        pipeline = self._pipeline_summary(pipeline_report, pipeline_progress_payloads or [])
        return {
            "ok": True,
            "discovery": discovery,
            "pipeline": pipeline,
            "combined": {"uidsAnalyzed": discovery["analyzed"] + pipeline["success"]},
        }

    def _discovery_summary(self, payload: Any) -> dict[str, int]:
        progress = payload if isinstance(payload, dict) else {}
        stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
        analyzed = _parse_number_or(stats.get("uidsAnalyzed"), 0)
        found = _parse_number_or(stats.get("uidsFound"), 0)
        return {
            "analyzed": analyzed,
            "found": found,
            "remaining": found - analyzed,
            "errors": _parse_number_or(stats.get("errors"), 0),
        }

    def _pipeline_summary(self, report_payload: Any, progress_payloads: list[Any]) -> dict[str, Any]:
        report = report_payload if isinstance(report_payload, dict) else {}
        stats = report.get("stats") if isinstance(report.get("stats"), dict) else {}
        processed = _parse_number_or(report.get("totalProcessed"), 0)
        total_expected = _parse_number_or(report.get("totalExpected"), 0)
        remaining = max(0, total_expected - processed)
        return {
            "processed": processed,
            "success": _parse_number_or(stats.get("success"), 0),
            "noComments": _parse_number_or(stats.get("noComments"), 0),
            "noVideos": self._sum_pipeline_stat(progress_payloads, "noVideos"),
            "noUser": _parse_number_or(stats.get("noUser"), 0),
            "errors": _parse_number_or(stats.get("errors"), 0),
            "remaining": remaining,
            "etaMinutes": math.ceil(remaining / self.pipeline_rate_per_minute),
            "etaHours": round(remaining / self.pipeline_rate_per_minute / 60, 1),
        }

    def _sum_pipeline_stat(self, progress_payloads: list[Any], key: str) -> int:
        total = 0
        for payload in progress_payloads:
            progress = payload if isinstance(payload, dict) else {}
            stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
            total += _parse_number_or(stats.get(key), 0)
        return total
