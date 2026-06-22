from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import (
    VideoRelevancePayloadContractComparator as VideoRelevanceContractComparator,
    VideoRelevancePayloadRunner as VideoRelevanceRunner,
    VideoRelevanceRequest,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Rank or filter Bilibili video objects by JS-compatible relevance rules.")
    parser.add_argument("--payload", required=True, help="JSON object with videos, searchQueries, targetExistingTerms, and operation.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video relevance report to compare.")
    return parser


class VideoRelevanceCliRunner:
    """CLI-compatible video relevance runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return VideoRelevanceRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoRelevanceCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
