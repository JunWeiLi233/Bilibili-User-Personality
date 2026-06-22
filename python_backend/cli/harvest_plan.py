from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.harvest_plan import (
    KeywordHarvestPlanPayloadContractComparator as KeywordHarvestPlanContractComparator,
    KeywordHarvestPlanRequest,
    KeywordHarvestPlanRunner,
)

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible keyword harvest query plan from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible keyword harvest plan JSON to compare.")
    return parser


class KeywordHarvestPlanCliRunner:
    """CLI-compatible keyword harvest plan runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return KeywordHarvestPlanRequest(
            payload_path=args.payload,
            compare_js_plan_path=args.compare_js_plan or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = KeywordHarvestPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
