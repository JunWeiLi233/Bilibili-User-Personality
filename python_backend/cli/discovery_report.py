from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.discovery_report import HarvestDiagnostics, VideoKeywordDiscoveryReporter, VideoKeywordDiscoveryReportSummary


class VideoKeywordDiscoveryReportRunner:
    """Build a video keyword discovery report from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "report").strip().lower()
        if mode == "diagnostics":
            return HarvestDiagnostics().build_from_payload(payload)
        return VideoKeywordDiscoveryReporter().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class VideoKeywordDiscoveryReportContractComparator:
    """Compare Python discovery reports against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoKeywordDiscoveryReportSummary()

    def compare(self) -> dict[str, Any]:
        python_result = VideoKeywordDiscoveryReportRunner(self.payload_path).run()
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
    parser = argparse.ArgumentParser(description="Build a video keyword discovery report from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to report payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible discovery report JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = VideoKeywordDiscoveryReportContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoKeywordDiscoveryReportRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
