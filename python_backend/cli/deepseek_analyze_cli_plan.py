from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek_cli import DeepSeekAnalyzeCliPlanCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalyzeCliPlanCommandRequest.parser()


class DeepSeekAnalyzeCliPlanCliRunner(DeepSeekAnalyzeCliPlanCommandRequest):
    """CLI-compatible analyzeDeepSeekComments plan runner for JS/Python contracts."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalyzeCliPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
