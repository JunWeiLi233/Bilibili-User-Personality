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


class BilibiliParseCliRunner:
    """CLI-compatible Bilibili parser runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return BilibiliParseContractComparator(args.payload, args.compare_js_report).compare()
        return BilibiliParseRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = BilibiliParseCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
