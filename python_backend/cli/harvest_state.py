from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.harvest_state import (
    HarvestStatePayloadContractComparator as HarvestStateContractComparator,
    HarvestStateRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update JS-compatible keyword harvest term-attempt state from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-state JSON payload.")
    parser.add_argument("--compare-js-state", default="", help="Optional JS-compatible harvest state JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_state:
        result = HarvestStateContractComparator(args.payload, args.compare_js_state).compare()
    else:
        result = HarvestStateRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
