from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek import DeepSeekAnalysisValidateContractComparator, DeepSeekAnalysisValidateRequest, DeepSeekAnalysisValidateRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate DeepSeek analysis quotes against source comments.")
    parser.add_argument("--payload", required=True, help="Path to the original JS-compatible analysis payload.")
    parser.add_argument("--analysis", required=True, help="Path to the DeepSeek analysis JSON or wrapper containing parsed/analysis.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible validation report to compare.")
    return parser


class DeepSeekAnalysisValidateCliRunner:
    """CLI-compatible DeepSeek validation runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalysisValidateRequest(
            payload_path=args.payload,
            analysis_path=args.analysis,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalysisValidateCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
