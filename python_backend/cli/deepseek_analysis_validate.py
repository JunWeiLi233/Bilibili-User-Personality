from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek import DeepSeekAnalysisValidateContractComparator, DeepSeekAnalysisValidateRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate DeepSeek analysis quotes against source comments.")
    parser.add_argument("--payload", required=True, help="Path to the original JS-compatible analysis payload.")
    parser.add_argument("--analysis", required=True, help="Path to the DeepSeek analysis JSON or wrapper containing parsed/analysis.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible validation report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = DeepSeekAnalysisValidateContractComparator(args.payload, args.analysis, args.compare_js_report).compare()
    else:
        result = DeepSeekAnalysisValidateRunner(args.payload, args.analysis).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
