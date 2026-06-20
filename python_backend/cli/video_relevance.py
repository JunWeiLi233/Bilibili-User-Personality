from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import (
    VideoRelevancePayloadContractComparator as VideoRelevanceContractComparator,
    VideoRelevancePayloadRunner as VideoRelevanceRunner,
)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Rank or filter Bilibili video objects by JS-compatible relevance rules.")
    parser.add_argument("--payload", required=True, help="JSON object with videos, searchQueries, targetExistingTerms, and operation.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video relevance report to compare.")
    args = parser.parse_args(argv)
    if args.compare_js_report:
        result = VideoRelevanceContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoRelevanceRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
