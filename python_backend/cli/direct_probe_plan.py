from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder, DirectProbePlanSummary


class DirectProbePlanRunner:
    """Build deterministic direct Bilibili probe planning outputs from JSON."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = DirectProbeCorpusBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.builder.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class DirectProbePlanContractComparator:
    """Compare Python direct-probe plans against saved JS-compatible plan JSON."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.summary = DirectProbePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_plan = DirectProbePlanRunner(self.payload_path).run()
        js_plan = self._read_js_plan()
        mismatches = [
            {"key": key, "python": python_plan.get(key), "js": js_plan.get(key)}
            for key in self.summary.PLAN_KEYS
            if key in js_plan and python_plan.get(key) != js_plan.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_plan),
            "js": self.summary.summarize(js_plan),
        }

    def _read_js_plan(self) -> dict[str, Any]:
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build direct Bilibili probe planning JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to direct probe plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible direct probe plan JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_plan:
        result = DirectProbePlanContractComparator(args.payload, args.compare_js_plan).compare()
    else:
        result = DirectProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
