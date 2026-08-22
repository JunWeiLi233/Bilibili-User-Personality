from __future__ import annotations

import sys

from python_backend.analysis.coverage_loop import CoverageHarvestLoopCommandCompareCommandRequest
from python_backend.runtime.json_contracts import JsonResultBytesContract


class CoverageHarvestLoopCommandCompareCliRunner(CoverageHarvestLoopCommandCompareCommandRequest):
    """CLI runner for persisted coverage-loop command report comparisons."""


def main(argv: list[str] | None = None) -> int:
    result = CoverageHarvestLoopCommandCompareCliRunner(argv).run()
    return JsonResultBytesContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
