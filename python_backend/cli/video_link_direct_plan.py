from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.video_link_direct import VideoLinkDirectPlanContractComparator, VideoLinkDirectPlanRequest, VideoLinkDirectPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a runVideoLinkDirect.js-compatible dry-run routing plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct-link plan report to compare.")
    return parser


class VideoLinkDirectPlanCliRunner:
    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = build_parser().parse_args(argv)
        return VideoLinkDirectPlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


def main(argv: list[str] | None = None) -> int:
    result = VideoLinkDirectPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
