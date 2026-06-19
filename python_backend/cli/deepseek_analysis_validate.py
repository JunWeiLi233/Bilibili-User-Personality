from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek import DeepSeekAnalysisValidationSummary, DeepSeekAnalysisValidator


class DeepSeekAnalysisValidateRunner:
    """Validate a DeepSeek analysis JSON file against the original JS-compatible payload."""

    def __init__(self, payload_path: str | Path, analysis_path: str | Path):
        self.payload_path = Path(payload_path)
        self.analysis_path = Path(analysis_path)
        self.validator = DeepSeekAnalysisValidator()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path)
        analysis = self._analysis_from_payload(self._read_json(self.analysis_path))
        return self.validator.validate(self._comments_from_payload(payload), analysis)

    def _read_json(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError(f"{path} must contain a JSON object.")
        return payload

    def _analysis_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        parsed = payload.get("parsed")
        if isinstance(parsed, dict):
            return parsed
        analysis = payload.get("analysis")
        if isinstance(analysis, dict):
            return analysis
        return payload

    def _comments_from_payload(self, payload: dict[str, Any]) -> list[str]:
        comments = payload.get("comments")
        if isinstance(comments, list):
            return [str(item) for item in comments if str(item).strip()]
        text = str(payload.get("text") or payload.get("fullText") or "").strip()
        return [text] if text else []


class DeepSeekAnalysisValidateContractComparator:
    """Compare Python DeepSeek validation output against a saved JS-compatible report."""

    def __init__(self, payload_path: str | Path, analysis_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.analysis_path = Path(analysis_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DeepSeekAnalysisValidationSummary()

    def compare(self) -> dict[str, Any]:
        python_result = DeepSeekAnalysisValidateRunner(self.payload_path, self.analysis_path).run()
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
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate DeepSeek analysis quotes against source comments.")
    parser.add_argument("--payload", required=True, help="Path to the original JS-compatible analysis payload.")
    parser.add_argument("--analysis", required=True, help="Path to the DeepSeek analysis JSON or wrapper containing parsed/analysis.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible validation report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = DeepSeekAnalysisValidateContractComparator(args.payload, args.analysis, args.compare_js_report).compare()
    else:
        result = DeepSeekAnalysisValidateRunner(args.payload, args.analysis).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
