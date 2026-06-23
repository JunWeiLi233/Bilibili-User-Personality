from __future__ import annotations

import argparse
import sys

from python_backend.corpus.contracts import CompareContractsCommandRequest, CompareContractsJsonResultContract


class CompareContractsRunner(CompareContractsCommandRequest):
    """CLI-compatible JS/Python contract comparator runner."""


def build_parser() -> argparse.ArgumentParser:
    return CompareContractsCommandRequest.parser()


def main(argv: list[str] | None = None) -> int:
    result = CompareContractsRunner(argv).run()
    CompareContractsJsonResultContract(result).write_text(sys.stdout)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
