from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.comment_coverage import CommentCoverageClassifier, CommentCoverageSummary


class CommentCoverageRunner:
    """Run comment coverage classification from JSON dictionary/comment contracts."""

    def __init__(
        self,
        dictionary_path: str | Path,
        comments_path: str | Path,
        sample_size: int | None = None,
    ) -> None:
        self.dictionary_path = Path(dictionary_path)
        self.comments_path = Path(comments_path)
        self.sample_size = sample_size
        self.classifier = CommentCoverageClassifier()

    def run(self) -> dict[str, Any]:
        dictionary = self._read_dictionary()
        comments = self._read_comments()
        options = {"sampleSize": self.sample_size} if self.sample_size is not None else {}
        return {
            "ok": True,
            "summary": self.classifier.sample(dictionary, comments, options),
        }

    def _read_dictionary(self) -> dict[str, Any]:
        payload = _read_json(self.dictionary_path)
        return payload if isinstance(payload, dict) else {"entries": []}

    def _read_comments(self) -> list[Any]:
        payload = _read_json(self.comments_path)
        if isinstance(payload, dict) and isinstance(payload.get("comments"), list):
            return payload["comments"]
        return payload if isinstance(payload, list) else []


class CommentCoverageContractComparator:
    """Compare Python comment coverage against a persisted JS-compatible report."""

    SUMMARY_KEYS = ("total", "covered", "uncovered", "coverageRatio")
    MODE_KEYS = ("keyword", "neutral", "uncovered")

    def __init__(
        self,
        dictionary_path: str | Path,
        comments_path: str | Path,
        js_report_path: str | Path,
        sample_size: int | None = None,
    ) -> None:
        self.dictionary_path = Path(dictionary_path)
        self.comments_path = Path(comments_path)
        self.js_report_path = Path(js_report_path)
        self.sample_size = sample_size
        self.summary = CommentCoverageSummary()

    def compare(self) -> dict[str, Any]:
        python_report = CommentCoverageRunner(self.dictionary_path, self.comments_path, self.sample_size).run()
        js_report = self._read_js_report()
        python_summary = python_report.get("summary") or {}
        js_summary = js_report.get("summary") if isinstance(js_report.get("summary"), dict) else js_report
        js_summary = js_summary if isinstance(js_summary, dict) else {}
        mismatches = self._summary_mismatches(python_summary, js_summary)
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {"summary": self.summary.summarize(python_summary)},
            "js": {"summary": self.summary.summarize(js_summary)},
        }

    def _read_js_report(self) -> dict[str, Any]:
        payload = _read_json(self.js_report_path)
        return payload if isinstance(payload, dict) else {}

    def _summary_mismatches(self, python_summary: dict[str, Any], js_summary: dict[str, Any]) -> list[dict[str, Any]]:
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        python_modes = python_summary.get("byMode") if isinstance(python_summary.get("byMode"), dict) else {}
        js_modes = js_summary.get("byMode") if isinstance(js_summary.get("byMode"), dict) else {}
        mismatches.extend(
            {"key": f"byMode.{key}", "python": python_modes.get(key), "js": js_modes.get(key)}
            for key in self.MODE_KEYS
            if key in js_modes and python_modes.get(key) != js_modes.get(key)
        )
        return mismatches

def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify comment coverage using the Python backend.")
    parser.add_argument(
        "--dictionary",
        default="server/data/keywordDictionary.json",
        help="Path to keyword dictionary JSON.",
    )
    parser.add_argument("--comments", required=True, help="Path to comment JSON array or object with comments array.")
    parser.add_argument("--sample-size", type=int, default=None, help="Maximum number of comments to classify.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible comment coverage report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = CommentCoverageContractComparator(args.dictionary, args.comments, args.compare_js_report, args.sample_size).compare()
    else:
        result = CommentCoverageRunner(args.dictionary, args.comments, args.sample_size).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
