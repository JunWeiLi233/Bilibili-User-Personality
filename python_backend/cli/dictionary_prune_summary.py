from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.dictionary_prune import DictionaryPruneSummaryPayloadContractComparator as DictionaryPruneSummaryContractComparator, DictionaryPruneSummaryRequest, DictionaryPruneSummaryRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run summary for dictionary pruning compatibility.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible prune summary JSON to compare.")
    return parser


class DictionaryPruneSummaryCliRunner:
    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = build_parser().parse_args(argv)
        return DictionaryPruneSummaryRequest(args.dictionary, compare_js_report_path=args.compare_js_report or None).run()


def main(argv: list[str] | None = None) -> int:
    result = DictionaryPruneSummaryCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
