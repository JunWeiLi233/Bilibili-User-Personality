from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.video_filter import VideoRelevanceFilter, VideoRelevanceSummary


class VideoRelevanceRunner:
    """Run JS-compatible video relevance ranking/filtering from a JSON contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.relevance = VideoRelevanceFilter()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        return self.relevance.run_from_payload(payload)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

class VideoRelevanceContractComparator:
    """Compare Python video relevance results against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoRelevanceSummary()

    def compare(self) -> dict[str, Any]:
        python_result = VideoRelevanceRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": self.summary.normalized_value(python_result.get(key)), "js": self.summary.normalized_value(js_result.get(key))}
            for key in self.summary.RESULT_KEYS
            if key in js_result and self.summary.normalized_value(python_result.get(key)) != self.summary.normalized_value(js_result.get(key))
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


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Rank or filter Bilibili video objects by JS-compatible relevance rules.")
    parser.add_argument("--payload", required=True, help="JSON object with videos, searchQueries, targetExistingTerms, and operation.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video relevance report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = VideoRelevanceContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoRelevanceRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
