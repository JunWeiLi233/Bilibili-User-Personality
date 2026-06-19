from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.cli.uid_pipeline_merge import UidPipelineMergeRunner
from python_backend.scrapers.scraper_monitor import ScraperMonitorPipelinePayloadPlanner, ScraperMonitorReporter, ScraperMonitorSummary


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


class ScraperMonitorContractComparator:
    """Compare Python monitor reports against saved JS-compatible JSON."""

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

    def compare(self) -> dict[str, Any]:
        python_result = ScraperMonitorRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            pipeline_rate_per_minute=self.pipeline_rate_per_minute,
        ).run()
        js_result = self._read_js_report()
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

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a compact scraper monitor report.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--total-start", type=int, default=1)
    parser.add_argument("--total-end", type=int, default=100000)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--pipeline-rate-per-minute", type=int, default=50)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible scraper monitor report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = ScraperMonitorContractComparator(
            args.data_dir,
            args.compare_js_report,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            pipeline_rate_per_minute=args.pipeline_rate_per_minute,
        ).compare()
    else:
        result = ScraperMonitorRunner(
            args.data_dir,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            pipeline_rate_per_minute=args.pipeline_rate_per_minute,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
