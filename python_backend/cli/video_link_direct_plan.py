from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.video_link_direct import VideoLinkDirectPlanContractComparator, VideoLinkDirectPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a runVideoLinkDirect.js-compatible dry-run routing plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct-link plan report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = VideoLinkDirectPlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoLinkDirectPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
