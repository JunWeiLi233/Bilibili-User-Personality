from __future__ import annotations

import argparse
import sys

from python_backend.analysis.audit import CoverageAuditCommandRequest, CoverageAuditJsonResultContract, CoverageAuditPayloadContractComparator as AuditContractComparator


class CoverageAuditCliRunner(CoverageAuditCommandRequest):
    """Dedicated argv-based coverage-audit comparator runner for JS/Python contracts."""


class CoverageAuditRunner(CoverageAuditCliRunner):
    """Backward-compatible coverage-audit runner alias."""


def build_parser() -> argparse.ArgumentParser:
    return CoverageAuditCommandRequest.parser()


def main(argv: list[str] | None = None) -> int:
    result = CoverageAuditCliRunner(argv).run()
    return CoverageAuditJsonResultContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
