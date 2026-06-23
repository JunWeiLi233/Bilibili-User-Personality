from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import safe_read_json_object
from python_backend.scrapers.uid_pipeline import UidPipelineMergeRunner


def _parse_number_or(value: Any, fallback: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        return fallback
    return parsed


class ScraperMonitorSummary:
    """Shape scraper monitor reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("discovery", "pipeline", "combined")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class ScraperMonitorContractComparator:
    """Compare scraper monitor reports using the shared JS/Python contract."""

    def __init__(self, summary: ScraperMonitorSummary | None = None):
        self.summary = summary or ScraperMonitorSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class ScraperMonitorRunner:
    """Build a compact monitor report for discovery and UID pipeline progress."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        pipeline_rate_per_minute: int = 50,
    ):
        self.data_dir = Path(data_dir)
        self.total_start = int(total_start)
        self.total_end = int(total_end)
        self.workers = max(1, int(workers))
        self.pipeline_rate_per_minute = max(1, int(pipeline_rate_per_minute))

    def run(self) -> dict[str, Any]:
        discovery = self._read_json(self.data_dir / "uid-discovery-progress.json", {})
        pipeline_report = UidPipelineMergeRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            summary_only=True,
            now=lambda: "",
        ).run()
        reporter = ScraperMonitorReporter(pipeline_rate_per_minute=self.pipeline_rate_per_minute)
        return reporter.build_report(
            discovery_progress=discovery,
            pipeline_report=pipeline_report,
            pipeline_progress_payloads=self._pipeline_progress_payloads(),
        )

    def _pipeline_progress_payloads(self) -> list[Any]:
        progress_files = ScraperMonitorPipelinePayloadPlanner().progress_files(total_start=self.total_start, total_end=self.total_end, workers=self.workers)
        return [self._read_json(self.data_dir / progress_file, {}) for progress_file in progress_files]

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class ScraperMonitorPayloadContractComparator:
    """Compare file-backed Python monitor reports against saved JS-compatible JSON."""

    def __init__(
        self,
        data_dir: str | Path,
        js_report_path: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        pipeline_rate_per_minute: int = 50,
    ):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.total_start = total_start
        self.total_end = total_end
        self.workers = workers
        self.pipeline_rate_per_minute = pipeline_rate_per_minute
        self.summary = ScraperMonitorSummary()
        self.comparator = ScraperMonitorContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = ScraperMonitorRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            pipeline_rate_per_minute=self.pipeline_rate_per_minute,
        ).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class ScraperMonitorRequest:
    """Scraper-layer request for monitor report JSON contract commands."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        compare_js_report_path: str | Path | None = None,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        pipeline_rate_per_minute: int = 50,
    ):
        self.data_dir = Path(data_dir)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.total_start = total_start
        self.total_end = total_end
        self.workers = workers
        self.pipeline_rate_per_minute = pipeline_rate_per_minute

    def run(self) -> dict[str, Any]:
        options = {
            "total_start": self.total_start,
            "total_end": self.total_end,
            "workers": self.workers,
            "pipeline_rate_per_minute": self.pipeline_rate_per_minute,
        }
        if self.compare_js_report_path:
            return ScraperMonitorPayloadContractComparator(
                self.data_dir,
                self.compare_js_report_path,
                **options,
            ).compare()
        return ScraperMonitorRunner(self.data_dir, **options).run()


class ScraperMonitorCommandRequest:
    """Argv-backed scraper-layer request for monitor report contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a compact scraper monitor report.")
        parser.add_argument("--data-dir", default="server/data")
        parser.add_argument("--total-start", type=int, default=1)
        parser.add_argument("--total-end", type=int, default=100000)
        parser.add_argument("--workers", type=int, default=5)
        parser.add_argument("--pipeline-rate-per-minute", type=int, default=50)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible scraper monitor report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return ScraperMonitorRequest(
            args.data_dir,
            compare_js_report_path=args.compare_js_report or None,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            pipeline_rate_per_minute=args.pipeline_rate_per_minute,
        ).run()


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
