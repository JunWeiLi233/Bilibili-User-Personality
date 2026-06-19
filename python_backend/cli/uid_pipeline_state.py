from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.uid_pipeline import UidPipelineStateReporter, UidPipelineStateSummary


class UidPipelineStateRunner:
    """Summarize live launchUidPipeline.js state and referenced worker progress files."""

    def __init__(self, data_dir: str | Path, *, state_file: str = "uid-pipeline-launcher.json"):
        self.data_dir = Path(data_dir)
        self.state_path = self.data_dir / state_file

    def run(self) -> dict[str, Any]:
        state = self._read_json(self.state_path, {})
        progress_by_file = {}
        raw_workers = state.get("workers") if isinstance(state.get("workers"), list) else []
        for raw_worker in raw_workers:
            if not isinstance(raw_worker, dict):
                continue
            start = int(raw_worker.get("start") or 0)
            end = int(raw_worker.get("end") or 0)
            progress_file = str(raw_worker.get("progressFile") or f"uid-pipeline-{start}-{end}.json")
            progress_by_file[progress_file] = self._read_json(self.data_dir / progress_file, {})
        return UidPipelineStateReporter().build_report(state, progress_by_file)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidPipelineStateContractComparator:
    """Compare Python live UID pipeline state summaries against saved JS-compatible JSON."""

    RESULT_KEYS = ("startedAt", "workers", "summary", "stats")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.summary = UidPipelineStateSummary()

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineStateRunner(self.data_dir).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
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
    parser = argparse.ArgumentParser(description="Summarize live UID pipeline launcher state and worker progress.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID pipeline state report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidPipelineStateContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = UidPipelineStateRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
