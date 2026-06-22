from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.coverage_progress import (
    CoverageProgressCommandRequest,
    CoverageProgressPayloadContractComparator as CoverageProgressContractComparator,
    CoverageProgressRunner,
)

def build_parser() -> argparse.ArgumentParser:
    return CoverageProgressCommandRequest.parser()


class CoverageProgressCliRunner:
    """CLI-compatible coverage progress runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        return CoverageProgressCommandRequest(self.argv).run()


def main(argv: list[str] | None = None) -> int:
    result = CoverageProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
