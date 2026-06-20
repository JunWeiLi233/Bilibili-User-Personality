from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import VideoContextContractComparator, VideoContextRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build Bilibili video context/evidence diagnostics from JSON.")
    parser.add_argument("--payload", required=True, help="JSON payload with videos, comments, search queries, and target terms.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video context report to compare.")
    return parser


class VideoContextCliRunner:
    """CLI-compatible video context runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return VideoContextContractComparator(args.payload, args.compare_js_report).compare()
        return VideoContextRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoContextCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
