from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_progress import CoverageProgressSummary, CoverageProgressTracker


class CoverageProgressRunner:
    """Evaluate coverage progress from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.tracker = CoverageProgressTracker()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        before = payload.get("before") if isinstance(payload.get("before"), dict) else {}
        after = payload.get("after") if isinstance(payload.get("after"), dict) else {}
        harvest_progress = payload.get("harvestProgress") if isinstance(payload.get("harvestProgress"), list) else []
        options = {
            "beforeActions": payload.get("beforeActions") if isinstance(payload.get("beforeActions"), list) else [],
            "afterActions": payload.get("afterActions") if isinstance(payload.get("afterActions"), list) else [],
        }
        delta = self.tracker.coverage_delta(before, after)
        harvest_delta = self.tracker.coverage_delta_from_harvest(before, after, harvest_progress)
        action_delta = self.tracker.action_progress_delta(options["beforeActions"], options["afterActions"])
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
        exhausted_options = payload.get("exhaustedOptions") if isinstance(payload.get("exhaustedOptions"), dict) else {}
        return {
            "ok": True,
            "delta": delta,
            "harvestDelta": harvest_delta,
            "actionDelta": action_delta,
            "exhaustedTerms": self.tracker.select_exhausted_terms(dictionary, state, exhausted_options),
            "hasDeltaProgress": self.tracker.has_coverage_delta_progress(delta),
            "hasHarvestProgress": self.tracker.has_coverage_delta_progress(harvest_delta),
            "hasGateProgress": self.tracker.has_coverage_gate_progress(before, after, options),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class CoverageProgressContractComparator:
    """Compare Python coverage-progress results against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CoverageProgressSummary()

    def compare(self) -> dict[str, Any]:
        python_result = CoverageProgressRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate coverage progress from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to coverage progress JSON payload.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible coverage progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = CoverageProgressContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = CoverageProgressRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
