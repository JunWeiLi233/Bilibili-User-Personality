from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbePlanCommandRequest, DirectProbePlanPayloadContractComparator as DirectProbePlanContractComparator, DirectProbePlanRunner


def build_parser() -> argparse.ArgumentParser:
    return DirectProbePlanCommandRequest.parser()


class DirectProbePlanCliRunner(DirectProbePlanCommandRequest):
    """Compatibility wrapper for the corpus-owned direct probe plan command."""


def main(argv: list[str] | None = None) -> int:
    result = DirectProbePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
