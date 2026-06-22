from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.bilibili_probe import BilibiliProbePlanPayloadContractComparator as BilibiliProbePlanContractComparator, BilibiliProbePlanRequest, BilibiliProbePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build Bilibili direct probe plans from JSON payloads.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili probe plan report to compare.")
    return parser


class BilibiliProbePlanCliRunner:
    """CLI-compatible Bilibili probe planner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BilibiliProbePlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


def main(argv: list[str] | None = None) -> int:
    result = BilibiliProbePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
