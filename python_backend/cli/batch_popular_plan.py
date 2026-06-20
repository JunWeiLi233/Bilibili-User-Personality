from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_popular import BatchPopularPlanPayloadContractComparator as BatchPopularPlanContractComparator, BatchPopularPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a batchScrapePopular.js-compatible dry-run page plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch popular plan report to compare.")
    return parser


class BatchPopularPlanCliRunner:
    """CLI-compatible batch popular plan runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return BatchPopularPlanContractComparator(args.payload, args.compare_js_report).compare()
        return BatchPopularPlanRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = BatchPopularPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
