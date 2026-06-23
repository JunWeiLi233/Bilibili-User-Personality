from __future__ import annotations

import argparse
import sys

from python_backend.analysis.coverage_loop import CoverageHarvestLoopCommandRequest
from python_backend.runtime.json_contracts import JsonResultBytesContract


class CoverageHarvestLoopCommandCliRunner(CoverageHarvestLoopCommandRequest):
    """CLI runner for the Python coverage harvest-loop command."""


class CoverageHarvestLoopCommandRunner(CoverageHarvestLoopCommandCliRunner):
    """Backward-compatible import alias for command tests and scripts."""


def build_parser() -> argparse.ArgumentParser:
    return CoverageHarvestLoopCommandRequest.parser()


def main(argv: list[str] | None = None) -> int:
    runner = CoverageHarvestLoopCommandCliRunner(argv)
    result = runner.run()
    exit_code = JsonResultBytesContract(result).run_text(sys.stdout)
    return 0 if runner.exit_zero() else exit_code


if __name__ == "__main__":
    raise SystemExit(main())
