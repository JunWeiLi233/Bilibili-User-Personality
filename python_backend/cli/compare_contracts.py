from __future__ import annotations

import argparse
import json

from python_backend.corpus.contracts import CompareContractsCommandRequest


class CompareContractsRunner(CompareContractsCommandRequest):
    """CLI-compatible JS/Python contract comparator runner."""


def build_parser() -> argparse.ArgumentParser:
    return CompareContractsCommandRequest([]).parser()


def main(argv: list[str] | None = None) -> int:
    result = CompareContractsRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
