from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.local_options import LocalCorpusMineOptionsPlanner


class LocalCorpusMinePlanRunner:
    """Read a JS-compatible local corpus mining payload and emit parsed options."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = LocalCorpusMineOptionsPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return {
            "ok": True,
            "options": self.planner.build_options(
                argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
                env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            ),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("Local corpus mine plan payload must be a JSON object.")
        return payload


class LocalCorpusMinePlanContractComparator:
    """Compare Python local-corpus mine plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("options",)

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = LocalCorpusMinePlanRunner(self.payload_path).run()
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
    parser = argparse.ArgumentParser(description="Build a mineLocalCorpusEvidence.js-compatible dry-run option plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local-corpus mine option report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = LocalCorpusMinePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = LocalCorpusMinePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
