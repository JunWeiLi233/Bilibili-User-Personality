from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.aicu import AicuBatchPlanPayloadContractComparator as AicuBatchPlanContractComparator, AicuBatchPlanRunner

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a batchScrapeAicu.js-compatible dry-run plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible AICU batch plan report to compare.")
    return parser


class AicuBatchPlanCliRunner:
    """CLI-compatible AICU batch plan runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return AicuBatchPlanContractComparator(args.payload, args.compare_js_report).compare()
        return AicuBatchPlanRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = AicuBatchPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
