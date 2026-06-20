from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_plan import KeywordHarvestPlanBuilder, KeywordHarvestPlanContractComparator as KeywordHarvestPlanPayloadComparator, KeywordHarvestPlanSummary


class KeywordHarvestPlanRunner:
    """Build keyword-harvest query plans from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = KeywordHarvestPlanBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.builder.build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class KeywordHarvestPlanContractComparator:
    """Compare Python keyword-harvest plans against saved JS-compatible plan JSON."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.summary = KeywordHarvestPlanSummary()
        self.comparator = KeywordHarvestPlanPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = KeywordHarvestPlanRunner(self.payload_path).run()
        js_result = self._read_js_plan()
        return self.comparator.compare(python_result, js_result)

    def _read_js_plan(self) -> dict[str, Any]:
        if not self.js_plan_path.exists():
            return {}
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible keyword harvest query plan from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible keyword harvest plan JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_plan:
        result = KeywordHarvestPlanContractComparator(args.payload, args.compare_js_plan).compare()
    else:
        result = KeywordHarvestPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
