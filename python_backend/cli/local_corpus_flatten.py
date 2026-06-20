from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.corpus.local import LocalCorpusFlattenSummary, LocalCorpusFlattener


class LocalCorpusFlattenRunner:
    """Flatten local corpus JSON into the shared comment contract."""

    def __init__(self, input_path: str | Path):
        self.input_path = Path(input_path)
        self.flattener = LocalCorpusFlattener()

    def run(self) -> dict[str, Any]:
        with self.input_path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
        comments = self.flattener.flatten(raw)
        return {
            "ok": True,
            "count": len(comments),
            "comments": comments,
        }


class LocalCorpusFlattenContractComparator:
    """Compare Python local-corpus flatten output against saved JS-compatible JSON."""

    def __init__(self, input_path: str | Path, js_report_path: str | Path):
        self.input_path = Path(input_path)
        self.js_report_path = Path(js_report_path)
        self.summary = LocalCorpusFlattenSummary()

    def compare(self) -> dict[str, Any]:
        python_result = LocalCorpusFlattenRunner(self.input_path).run()
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

def main() -> int:
    parser = argparse.ArgumentParser(description="Flatten local Bilibili/Tieba corpus JSON into JS-compatible comments.")
    parser.add_argument("--input", required=True, help="Input JSON file to flatten.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local corpus flatten report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = LocalCorpusFlattenContractComparator(args.input, args.compare_js_report).compare()
    else:
        result = LocalCorpusFlattenRunner(args.input).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
