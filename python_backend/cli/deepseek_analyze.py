from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek_cli import DeepSeekAnalyzeCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalyzeCommandRequest.parser()


class DeepSeekAnalyzeCliRunner(DeepSeekAnalyzeCommandRequest):
    """CLI-compatible Python DeepSeek analyze command runner."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalyzeCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
