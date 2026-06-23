from __future__ import annotations

import argparse
import sys

from python_backend.analysis.audit import (
    CoverageAuditArtifactsCommandRequest,
    CoverageAuditArtifactsJsonResultContract,
    CoverageAuditArtifactsPayloadContractComparator as CoverageAuditArtifactsContractComparator,
    CoverageAuditArtifactsRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return CoverageAuditArtifactsCommandRequest.parser()


class CoverageAuditArtifactsCliRunner(CoverageAuditArtifactsCommandRequest):
    """CLI-compatible coverage-audit artifact runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = CoverageAuditArtifactsCliRunner(argv).run()
    CoverageAuditArtifactsJsonResultContract(result).write_text(sys.stdout)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
