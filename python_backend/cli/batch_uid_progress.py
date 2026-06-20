from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_scrape import (
    BatchUidProgressPayloadContractComparator as BatchUidProgressContractComparator,
    BatchUidProgressRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize batch UID scrape progress JSON.")
    parser.add_argument("--progress", default="server/data/batch-uid-progress.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch UID progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BatchUidProgressContractComparator(args.progress, args.compare_js_report).compare()
    else:
        result = BatchUidProgressRunner(args.progress).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
