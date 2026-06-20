from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_range import (
    UidRangeProgressPayloadContractComparator as UidRangeProgressContractComparator,
    UidRangeProgressRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize batch UID range progress JSON.")
    parser.add_argument("--progress", default="server/data/batch-uid-range-progress.json")
    parser.add_argument("--start", type=int, default=200000)
    parser.add_argument("--end", type=int, default=300000)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID range report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidRangeProgressContractComparator(args.progress, args.compare_js_report, start=args.start, end=args.end).compare()
    else:
        result = UidRangeProgressRunner(args.progress, start=args.start, end=args.end).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
