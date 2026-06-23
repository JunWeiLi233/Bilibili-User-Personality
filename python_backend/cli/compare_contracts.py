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
    contract = CompareContractsJsonResultContract(result)
    contract.write_text(sys.stdout)
    return contract.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
