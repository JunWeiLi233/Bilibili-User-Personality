from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.uid_fast_pipeline import FastPipelineLauncherPlanner


class FastPipelineLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchFastWorkers.ps1."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        script: str = "server/scripts/uidPipelineFast.js",
        launch_delay_seconds: int = 5,
    ):
        self.data_dir = Path(data_dir)
        self.script = script
        self.launch_delay_seconds = int(launch_delay_seconds)

    def run(self) -> dict[str, Any]:
        return FastPipelineLauncherPlanner().build_plan(data_dir=self.data_dir, script=self.script, launch_delay_seconds=self.launch_delay_seconds)


class FastPipelineLauncherContractComparator:
    """Compare Python fast pipeline launch plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("workers", "summary")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = self._contract_summary(FastPipelineLauncherPlanRunner(self.data_dir).run())
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {key: python_result.get(key) for key in self.RESULT_KEYS if key in python_result},
            "js": {key: js_result.get(key) for key in self.RESULT_KEYS if key in js_result},
        }

    def _contract_summary(self, result: dict[str, Any]) -> dict[str, Any]:
        workers = [
            {"start": worker["start"], "end": worker["end"], "progressFile": worker["progressFile"]}
            for worker in result.get("workers", [])
            if isinstance(worker, dict)
        ]
        return {"workers": workers, "summary": result.get("summary")}

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run fast UID pipeline launcher plan.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible fast pipeline launcher report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = FastPipelineLauncherContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = FastPipelineLauncherPlanRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
