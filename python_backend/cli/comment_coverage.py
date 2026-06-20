from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.comment_coverage import CommentCoveragePayloadContractComparator as CommentCoverageContractComparator, CommentCoverageRequest, CommentCoverageRunner


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


class CommentCoverageCliRunner:
    """CLI-compatible comment coverage runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        parser = build_parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.payload and not args.comments:
            parser.error("--comments is required unless --payload is provided")
        return CommentCoverageRequest(
            dictionary_path=args.dictionary,
            comments_path=args.comments or None,
            sample_size=args.sample_size,
            payload_path=args.payload or None,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = CommentCoverageCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
