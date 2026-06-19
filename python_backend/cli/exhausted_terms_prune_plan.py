from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_progress import CoverageProgressTracker
from python_backend.corpus.dictionary import DictionaryLoader


class ExhaustedTermsPrunePlanRunner:
    """Build a dry-run prune plan for repeatedly missed dictionary terms."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        *,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.target_evidence = target_evidence
        self.attempt_threshold = attempt_threshold
        self.require_zero_evidence = require_zero_evidence
        self.require_source_backed_evidence = require_source_backed_evidence
        self.require_comment_backed_evidence = require_comment_backed_evidence
        self.tracker = CoverageProgressTracker()

    def run(self) -> dict[str, Any]:
        loaded_dictionary = DictionaryLoader(self.dictionary_path).load()
        dictionary = {**loaded_dictionary.manifest, "entries": loaded_dictionary.entries}
        state = self._read_json(self.state_path, {"termAttempts": {}})
        options = {
            "targetEvidence": self.target_evidence,
            "attemptThreshold": self.attempt_threshold,
            "requireZeroEvidence": self.require_zero_evidence,
            "requireSourceBackedEvidence": self.require_source_backed_evidence,
            "requireCommentBackedEvidence": self.require_comment_backed_evidence,
        }
        candidates = self.tracker.select_exhausted_terms(dictionary, state, options)
        return {
            "ok": True,
            "targetEvidence": max(1, int(self.target_evidence)),
            "attemptThreshold": max(1, int(self.attempt_threshold)),
            "requireZeroEvidence": self.require_zero_evidence,
            "requireSourceBackedEvidence": self.require_source_backed_evidence,
            "requireCommentBackedEvidence": self.require_comment_backed_evidence,
            "count": len(candidates),
            "candidates": candidates,
            "summary": {
                "attemptThreshold": max(1, int(self.attempt_threshold)),
                "requireZeroEvidence": self.require_zero_evidence,
                "candidates": len(candidates),
            },
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class ExhaustedTermsPrunePlanContractComparator:
    """Compare Python exhausted-term prune plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("count", "candidates", "summary")

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        js_report_path: str | Path,
        *,
        target_evidence: int = 3,
        attempt_threshold: int = 10,
        require_zero_evidence: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.js_report_path = Path(js_report_path)
        self.target_evidence = target_evidence
        self.attempt_threshold = attempt_threshold
        self.require_zero_evidence = require_zero_evidence
        self.require_source_backed_evidence = require_source_backed_evidence
        self.require_comment_backed_evidence = require_comment_backed_evidence

    def compare(self) -> dict[str, Any]:
        python_result = ExhaustedTermsPrunePlanRunner(
            self.dictionary_path,
            self.state_path,
            target_evidence=self.target_evidence,
            attempt_threshold=self.attempt_threshold,
            require_zero_evidence=self.require_zero_evidence,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
        ).run()
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
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run prune plan for exhausted dictionary terms.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--state", default="server/data/keywordHarvestState.json")
    parser.add_argument("--target-evidence", type=int, default=3)
    parser.add_argument("--attempt-threshold", type=int, default=10)
    parser.add_argument("--include-partial", action="store_true", help="Include terms below target evidence, not only zero-evidence terms.")
    parser.add_argument("--require-source-backed-evidence", action="store_true")
    parser.add_argument("--require-comment-backed-evidence", action="store_true")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible exhausted-term prune report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    require_zero_evidence = not args.include_partial
    if args.compare_js_report:
        result = ExhaustedTermsPrunePlanContractComparator(
            args.dictionary,
            args.state,
            args.compare_js_report,
            target_evidence=args.target_evidence,
            attempt_threshold=args.attempt_threshold,
            require_zero_evidence=require_zero_evidence,
            require_source_backed_evidence=args.require_source_backed_evidence,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
        ).compare()
    else:
        result = ExhaustedTermsPrunePlanRunner(
            args.dictionary,
            args.state,
            target_evidence=args.target_evidence,
            attempt_threshold=args.attempt_threshold,
            require_zero_evidence=require_zero_evidence,
            require_source_backed_evidence=args.require_source_backed_evidence,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
