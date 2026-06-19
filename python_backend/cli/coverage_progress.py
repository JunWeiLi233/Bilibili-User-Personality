from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_progress import CoverageProgressTracker


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate coverage progress from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to coverage progress JSON payload.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = CoverageProgressRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
