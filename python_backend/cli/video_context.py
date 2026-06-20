from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import VideoContextContractComparator, VideoContextRunner


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build Bilibili video context/evidence diagnostics from JSON.")
    parser.add_argument("--payload", required=True, help="JSON payload with videos, comments, search queries, and target terms.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video context report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = VideoContextContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoContextRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
