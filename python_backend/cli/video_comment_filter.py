from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import (
    VideoCommentFilterPayloadContractComparator as VideoCommentFilterContractComparator,
    VideoCommentFilterPayloadRunner as VideoCommentFilterRunner,
    VideoCommentFilterRequest,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Filter Bilibili comments by dictionary needle JSON.")
    parser.add_argument("--comments", required=True, help="JSON list or object with a comments array.")
    parser.add_argument("--needles", required=True, help="JSON list or object with a needles array.")
    parser.add_argument("--extra-needle", action="append", default=[])
    parser.add_argument("--dictionary-mode", action="store_true", help="Treat --needles as a dictionary JSON payload.")
    parser.add_argument("--existing-terms-only", action="store_true", help="Apply filtering only for existing-term dictionary refreshes.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible comment filter report to compare.")
    return parser


class VideoCommentFilterCliRunner:
    """CLI-compatible comment filter runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return VideoCommentFilterRequest(
            args.comments,
            args.needles,
            args.extra_needle,
            args.dictionary_mode,
            args.existing_terms_only,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoCommentFilterCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
