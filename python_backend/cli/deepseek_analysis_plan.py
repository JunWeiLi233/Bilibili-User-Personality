from __future__ import annotations

import argparse
import sys

from python_backend.analyzers.deepseek import (
    DeepSeekAnalysisPlanCommandRequest,
    DeepSeekAnalysisPlanContractComparator,
    DeepSeekAnalysisPlanRunner,
)
from python_backend.runtime.json_contracts import JsonResultBytesContract


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalysisPlanCommandRequest.parser()


class DeepSeekAnalysisPlanCliRunner(DeepSeekAnalysisPlanCommandRequest):
    """CLI-compatible DeepSeek analysis plan runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalysisPlanCliRunner(argv).run()
    return JsonResultBytesContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
