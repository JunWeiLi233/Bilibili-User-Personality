from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.harvest_options import (
    HarvestOptionsCommandRequest,
    HarvestOptionsPayloadContractComparator as HarvestOptionsContractComparator,
    HarvestOptionsRunner,
)

def build_parser() -> argparse.ArgumentParser:
    return HarvestOptionsCommandRequest.parser()


class HarvestOptionsCliRunner(HarvestOptionsCommandRequest):
    """CLI-compatible harvest options runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = HarvestOptionsCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
