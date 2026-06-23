from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek import DeepSeekAnalysisNormalizeCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalysisNormalizeCommandRequest.parser()


class DeepSeekAnalysisNormalizeCliRunner(DeepSeekAnalysisNormalizeCommandRequest):
    """CLI-compatible DeepSeek analysis normalization runner."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalysisNormalizeCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
