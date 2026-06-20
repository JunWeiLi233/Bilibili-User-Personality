from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.tieba_html import TiebaHtmlParsePayloadContractComparator as TiebaHtmlParseContractComparator, TiebaHtmlParseRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Tieba HTML into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode/html/thread fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba HTML parse report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = TiebaHtmlParseContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = TiebaHtmlParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
