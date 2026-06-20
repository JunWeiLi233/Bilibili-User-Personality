from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerPayloadContractComparator as BilibiliCrawlerContractComparator, BilibiliCrawlerRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Bilibili crawler helper functions from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to crawler helper payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible crawler helper report to compare.")
    return parser


class BilibiliCrawlerCliRunner:
    """CLI-compatible Bilibili crawler helper runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return BilibiliCrawlerContractComparator(args.payload, args.compare_js_report).compare()
        return BilibiliCrawlerRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = BilibiliCrawlerCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
