from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_loop import CoverageHarvestLoopPlanContractComparator as CoverageHarvestLoopPlanPayloadComparator, CoverageHarvestLoopPlanSummary, CoverageHarvestLoopPlanner


class CoverageHarvestLoopPlanRunner:
    """Build an auto coverage-harvest loop plan from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return CoverageHarvestLoopPlanner().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class CoverageHarvestLoopPlanContractComparator:
    """Compare Python coverage-loop plan output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CoverageHarvestLoopPlanSummary()
        self.comparator = CoverageHarvestLoopPlanPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = CoverageHarvestLoopPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a coverage harvest loop plan from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to coverage-loop payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible coverage-loop report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = CoverageHarvestLoopPlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = CoverageHarvestLoopPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
