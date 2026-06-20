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


class HarvestStateCliRunner:
    """CLI-compatible harvest state runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_state:
            return HarvestStateContractComparator(args.payload, args.compare_js_state).compare()
        return HarvestStateRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = HarvestStateCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
