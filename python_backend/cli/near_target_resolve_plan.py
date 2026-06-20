from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.near_target import NearTargetOverrideTermsParser, NearTargetResolvePlanContractComparator, NearTargetResolvePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run near-target resolver plan from dictionary source videos.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--state", default="server/data/keywordHarvestState.json")
    parser.add_argument("--target-evidence", type=int, default=3)
    parser.add_argument("--max-need", type=int, default=1)
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--videos-per-term", type=int, default=3)
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--override-terms", default="", help="Comma/newline/pipe separated terms to plan even when not near target.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible near-target resolve plan to compare.")
    return parser


class NearTargetResolvePlanCliRunner:
    """CLI-compatible near-target resolver runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        override_terms = NearTargetOverrideTermsParser().parse(args.override_terms)
        if args.compare_js_plan:
            return NearTargetResolvePlanContractComparator(
                args.dictionary,
                args.state,
                args.compare_js_plan,
                target_evidence=args.target_evidence,
                max_need=args.max_need,
                batch=args.batch,
                videos_per_term=args.videos_per_term,
                pages=args.pages,
                override_terms=override_terms,
            ).compare()
        return NearTargetResolvePlanRunner(
            args.dictionary,
            args.state,
            target_evidence=args.target_evidence,
            max_need=args.max_need,
            batch=args.batch,
            videos_per_term=args.videos_per_term,
            pages=args.pages,
            override_terms=override_terms,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = NearTargetResolvePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
