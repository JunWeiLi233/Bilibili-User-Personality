from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.batch_uid_range import BatchUidRangePlanner


class BatchUidRangePlanRunner:
    """Read a JS-compatible batchUidRange payload and emit its dry-run plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = BatchUidRangePlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            progress=payload.get("progress") if isinstance(payload.get("progress"), dict) else {},
            database=payload.get("database") if isinstance(payload.get("database"), dict) else {},
        )

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("Batch UID range plan payload must be a JSON object.")
        return payload


class BatchUidRangePlanContractComparator:
    """Compare Python batch UID range dry-run plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("input", "phase1", "phase2", "stats", "pacing")

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = BatchUidRangePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a batchUidRange.js-compatible dry-run plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch UID range plan report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BatchUidRangePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = BatchUidRangePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
