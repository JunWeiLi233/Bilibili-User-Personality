from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.semantic_matcher import (
    SemanticMatcherCommandRequest,
    SemanticMatcherPayloadContractComparator as SemanticMatcherContractComparator,
    SemanticMatcherRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return SemanticMatcherCommandRequest([]).parser()


class SemanticMatcherCliRunner(SemanticMatcherCommandRequest):
    """CLI-compatible semantic matcher runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = SemanticMatcherCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
