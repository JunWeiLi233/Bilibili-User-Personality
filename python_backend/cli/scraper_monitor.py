from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.scraper_monitor import ScraperMonitorPayloadContractComparator as ScraperMonitorContractComparator, ScraperMonitorRunner

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
