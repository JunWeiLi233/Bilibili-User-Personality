from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.dictionary_prune import DictionaryPrunePlanner


class DictionaryPruneSummaryRunner:
    """Build a Python dry-run summary for the JS dictionary prune command."""

    def __init__(self, dictionary_path: str | Path):
        self.dictionary_path = Path(dictionary_path)

    def run(self) -> dict[str, Any]:
        loaded = DictionaryLoader(self.dictionary_path).load()
        entries = loaded.entries
        plan = DictionaryPrunePlanner().build(entries)
        return {
            "ok": True,
            "dictionaryPath": str(self.dictionary_path),
            **plan,
        }


class DictionaryPruneSummaryContractComparator:
    """Compare Python prune summaries against a saved JS-compatible JSON report."""

    RESULT_KEYS = ("entries", "asciiTerms", "summary")

    def __init__(self, dictionary_path: str | Path, js_report_path: str | Path):
        self.dictionary_path = Path(dictionary_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = DictionaryPruneSummaryRunner(self.dictionary_path).run()
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
    parser = argparse.ArgumentParser(description="Build a dry-run summary for dictionary pruning compatibility.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible prune summary JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = DictionaryPruneSummaryContractComparator(args.dictionary, args.compare_js_report).compare()
    else:
        result = DictionaryPruneSummaryRunner(args.dictionary).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
