from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.dictionary_prune import ExhaustedTermsPrunePlanPayloadContractComparator as ExhaustedTermsPrunePlanContractComparator, ExhaustedTermsPrunePlanRunner


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
