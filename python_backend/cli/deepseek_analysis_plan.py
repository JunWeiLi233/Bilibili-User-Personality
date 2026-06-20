from __future__ import annotations

import argparse
import json

from python_backend.analyzers.deepseek import DeepSeekAnalysisPlanContractComparator, DeepSeekAnalysisPlanRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a Python-owned DeepSeek analyzer request plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to a JSON payload containing text/comments and optional keywordHints.")
    parser.add_argument("--compact", action="store_true", help="Build the compact retry prompt variant.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible DeepSeek plan JSON to compare.")
    args = parser.parse_args()
    if args.compare_js_plan:
        result = DeepSeekAnalysisPlanContractComparator(args.payload, args.compare_js_plan, compact=args.compact).compare()
    else:
        result = DeepSeekAnalysisPlanRunner(args.payload, compact=args.compact).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
