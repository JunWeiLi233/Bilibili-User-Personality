from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.aicu import AicuBatchProgressPayloadContractComparator as BatchScrapeProgressContractComparator, BatchScrapeProgressRequest, BatchScrapeProgressRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize legacy batch scrape progress JSON.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--progress-file", default="batch-scrape-progress.json")
    parser.add_argument("--database-file", default="aicu-user-database.json")
    parser.add_argument("--mode", choices=("uid-range", "popular"), default="uid-range")
    parser.add_argument("--start-uid", type=int, default=100000)
    parser.add_argument("--end-uid", type=int, default=200000)
    parser.add_argument("--pages", type=int, default=50)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch scrape progress report to compare.")
    return parser


class BatchScrapeProgressCliRunner:
    """CLI-compatible batch scrape progress runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        runner_options = {
            "progress_file": args.progress_file,
            "database_file": args.database_file,
            "mode": args.mode,
            "start_uid": args.start_uid,
            "end_uid": args.end_uid,
            "pages": args.pages,
        }
        return BatchScrapeProgressRequest(args.data_dir, compare_js_report_path=args.compare_js_report, **runner_options).run()


def main(argv: list[str] | None = None) -> int:
    result = BatchScrapeProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
