from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.bilibili import BilibiliParsePayloadContractComparator as BilibiliParseContractComparator, BilibiliParseRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Bilibili public payloads into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili parser report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BilibiliParseContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = BilibiliParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
