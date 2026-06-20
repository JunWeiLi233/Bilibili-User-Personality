from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek_cli import DeepSeekAnalyzeCliPlanContractComparator as DeepSeekAnalyzeCliPlanPayloadComparator, DeepSeekAnalyzeCliPlanner, DeepSeekAnalyzeCliPlanSummary


class DeepSeekAnalyzeCliPlanRunner:
    """Read a JS-compatible deepseek:analyze CLI payload and emit its input plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = DeepSeekAnalyzeCliPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        argv = payload.get("argv") if isinstance(payload.get("argv"), list) else []
        stdin_is_tty = bool(payload.get("stdinIsTTY", True))
        return self.planner.build_plan(argv, stdin_is_tty=stdin_is_tty)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("DeepSeek analyze CLI payload must be a JSON object.")
        return payload


class DeepSeekAnalyzeCliPlanContractComparator:
    """Compare Python CLI input plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DeepSeekAnalyzeCliPlanSummary()
        self.comparator = DeepSeekAnalyzeCliPlanPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = DeepSeekAnalyzeCliPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build an analyzeDeepSeekComments.js-compatible CLI input plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible CLI parse report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = DeepSeekAnalyzeCliPlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = DeepSeekAnalyzeCliPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
