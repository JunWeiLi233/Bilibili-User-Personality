from __future__ import annotations

import sys

from python_backend.analysis.verification import (
    RandomVerificationCompareCommandRequest,
    RandomVerificationJsonResultContract,
)


class RandomVerificationCompareCliRunner(RandomVerificationCompareCommandRequest):
    """Dedicated argv runner for persisted random-verification report comparisons."""


def main(argv: list[str] | None = None) -> int:
    result = RandomVerificationCompareCliRunner(argv).run()
    return RandomVerificationJsonResultContract(result).run_bytes(sys.stdout.buffer)


if __name__ == "__main__":
    raise SystemExit(main())
