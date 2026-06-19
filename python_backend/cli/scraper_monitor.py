from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from python_backend.cli.uid_pipeline_merge import UidPipelineMergeRunner


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
        discovery = self._discovery_summary()
        pipeline = self._pipeline_summary()
        return {
            "ok": True,
            "discovery": discovery,
            "pipeline": pipeline,
            "combined": {"uidsAnalyzed": discovery["analyzed"] + pipeline["success"]},
        }

    def _discovery_summary(self) -> dict[str, int]:
        payload = self._read_json(self.data_dir / "uid-discovery-progress.json", {})
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        analyzed = int(stats.get("uidsAnalyzed") or 0)
        found = int(stats.get("uidsFound") or 0)
        return {
            "analyzed": analyzed,
            "found": found,
            "remaining": found - analyzed,
            "errors": int(stats.get("errors") or 0),
        }

    def _pipeline_summary(self) -> dict[str, Any]:
        report = UidPipelineMergeRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            summary_only=True,
            now=lambda: "",
        ).run()
        stats = report.get("stats") if isinstance(report.get("stats"), dict) else {}
        no_videos = self._sum_pipeline_stat("noVideos")
        remaining = max(0, int(report.get("totalExpected") or 0) - int(report.get("totalProcessed") or 0))
        eta_minutes = math.ceil(remaining / self.pipeline_rate_per_minute)
        return {
            "processed": int(report.get("totalProcessed") or 0),
            "success": int(stats.get("success") or 0),
            "noComments": int(stats.get("noComments") or 0),
            "noVideos": no_videos,
            "noUser": int(stats.get("noUser") or 0),
            "errors": int(stats.get("errors") or 0),
            "remaining": remaining,
            "etaMinutes": eta_minutes,
            "etaHours": round(remaining / self.pipeline_rate_per_minute / 60, 1),
        }

    def _sum_pipeline_stat(self, key: str) -> int:
        total_expected = max(0, self.total_end - self.total_start + 1)
        chunk_size = math.ceil(total_expected / self.workers) if total_expected else 0
        total = 0
        for worker_index in range(self.workers):
            start = self.total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, self.total_end)
            if start > self.total_end:
                break
            payload = self._read_json(self.data_dir / f"uid-pipeline-{start}-{end}.json", {})
            stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
            total += int(stats.get(key) or 0)
        return total

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class ScraperMonitorContractComparator:
    """Compare Python monitor reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("discovery", "pipeline", "combined")

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
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


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
