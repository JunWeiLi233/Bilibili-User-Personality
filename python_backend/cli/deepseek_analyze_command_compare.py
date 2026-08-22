from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek_cli import DeepSeekAnalyzeCommandReportCompareCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalyzeCommandReportCompareCommandRequest.parser()


class DeepSeekAnalyzeCommandCompareCliRunner(DeepSeekAnalyzeCommandReportCompareCommandRequest):
    """CLI-compatible saved DeepSeek analyze command report comparator."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalyzeCommandCompareCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
