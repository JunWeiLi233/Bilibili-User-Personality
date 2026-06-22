from __future__ import annotations

import argparse
import json

from python_backend.analyzers.deepseek import (
    DeepSeekAnalysisPlanCommandRequest,
    DeepSeekAnalysisPlanContractComparator,
    DeepSeekAnalysisPlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalysisPlanCommandRequest([]).parser()


class DeepSeekAnalysisPlanCliRunner(DeepSeekAnalysisPlanCommandRequest):
    """CLI-compatible DeepSeek analysis plan runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekAnalysisPlanCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
