from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.coverage_progress import (
    CoverageProgressPayloadContractComparator as CoverageProgressContractComparator,
    CoverageProgressRunner,
)

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate coverage progress from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to coverage progress JSON payload.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible coverage progress report to compare.")
    return parser


class CoverageProgressCliRunner:
    """CLI-compatible coverage progress runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return CoverageProgressContractComparator(args.payload, args.compare_js_report).compare()
        return CoverageProgressRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = CoverageProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
