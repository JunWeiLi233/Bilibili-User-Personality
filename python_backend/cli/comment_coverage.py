from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.comment_coverage import CommentCoverageJsonPayloadRunner, CommentCoveragePayloadContractComparator as CommentCoverageContractComparator, CommentCoverageRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify comment coverage using the Python backend.")
    parser.add_argument("--payload", default="", help="Single JSON payload containing dictionary, comments, and optional sampleSize.")
    parser.add_argument(
        "--dictionary",
        default="server/data/keywordDictionary.json",
        help="Path to keyword dictionary JSON.",
    )
    parser.add_argument("--comments", default="", help="Path to comment JSON array or object with comments array.")
    parser.add_argument("--sample-size", type=int, default=None, help="Maximum number of comments to classify.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible comment coverage report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.payload:
        result = CommentCoverageJsonPayloadRunner(args.payload).run()
    elif args.compare_js_report:
        if not args.comments:
            parser.error("--comments is required unless --payload is provided")
        result = CommentCoverageContractComparator(args.dictionary, args.comments, args.compare_js_report, args.sample_size).compare()
    else:
        if not args.comments:
            parser.error("--comments is required unless --payload is provided")
        result = CommentCoverageRunner(args.dictionary, args.comments, args.sample_size).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
