from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_range import (
    RangeScraperLauncherPayloadContractComparator as RangeScraperLauncherContractComparator,
    RangeScraperLauncherPlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run UID range scraper launcher plan.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible range launcher report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = RangeScraperLauncherContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = RangeScraperLauncherPlanRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
