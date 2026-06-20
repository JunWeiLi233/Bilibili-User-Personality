from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.aicu import AicuScrapePlanPayloadContractComparator as AicuScrapePlanContractComparator, AicuScrapePlanRunner

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a Python AICU scrape dry-run plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible AICU scrape plan report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = AicuScrapePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = AicuScrapePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
