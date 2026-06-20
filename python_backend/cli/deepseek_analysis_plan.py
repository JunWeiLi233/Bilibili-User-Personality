from __future__ import annotations

import argparse
import json

from python_backend.analyzers.deepseek import DeepSeekAnalysisPlanContractComparator, DeepSeekAnalysisPlanRequest, DeepSeekAnalysisPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a Python-owned DeepSeek analyzer request plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to a JSON payload containing text/comments and optional keywordHints.")
    parser.add_argument("--compact", action="store_true", help="Build the compact retry prompt variant.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible DeepSeek plan JSON to compare.")
    return parser


class DeepSeekAnalysisPlanCliRunner:
    """CLI-compatible DeepSeek analysis plan runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalysisPlanRequest(
            payload_path=args.payload,
            compact=args.compact,
            compare_js_plan_path=args.compare_js_plan or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalysisPlanCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
