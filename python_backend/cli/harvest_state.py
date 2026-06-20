from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_state import HarvestStatePayloadProcessor, HarvestStateSummary


class HarvestStateRunner:
    """Update keyword-harvest state from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return HarvestStatePayloadProcessor().process(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class HarvestStateContractComparator:
    """Compare Python harvest state against a persisted JS-compatible state report."""

    def __init__(self, payload_path: str | Path, js_state_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_state_path = Path(js_state_path)
        self.summary = HarvestStateSummary()

    def compare(self) -> dict[str, Any]:
        python_result = HarvestStateRunner(self.payload_path).run()
        js_result = self._read_js_state()
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {"ok": not mismatches, "mismatches": mismatches, "python": python_summary, "js": js_summary}

    def _read_js_state(self) -> dict[str, Any]:
        if not self.js_state_path.exists():
            return {}
        with self.js_state_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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
