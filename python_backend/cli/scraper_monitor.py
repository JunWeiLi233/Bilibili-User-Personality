from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.scraper_monitor import ScraperMonitorRequest

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a compact scraper monitor report.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--total-start", type=int, default=1)
    parser.add_argument("--total-end", type=int, default=100000)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--pipeline-rate-per-minute", type=int, default=50)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible scraper monitor report to compare.")
    return parser


class ScraperMonitorCliRunner:
    """CLI-compatible scraper monitor runner for JS/Python JSON progress contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return ScraperMonitorRequest(
            args.data_dir,
            compare_js_report_path=args.compare_js_report or None,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            pipeline_rate_per_minute=args.pipeline_rate_per_minute,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = ScraperMonitorCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
