from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.readme_stats import (
    ReadmeStatsPayloadContractComparator as ReadmeStatsContractComparator,
    ReadmeStatsRunner,
)

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build README stats and timeline JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to README stats payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible README stats report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = ReadmeStatsContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = ReadmeStatsRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
