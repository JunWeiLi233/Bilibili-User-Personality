from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.harvest_plan import (
    KeywordHarvestPlanCommandRequest,
    KeywordHarvestPlanPayloadContractComparator as KeywordHarvestPlanContractComparator,
    KeywordHarvestPlanRunner,
)

def build_parser() -> argparse.ArgumentParser:
    return KeywordHarvestPlanCommandRequest.parser()


class KeywordHarvestPlanCliRunner(KeywordHarvestPlanCommandRequest):
    """CLI-compatible keyword harvest plan runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = KeywordHarvestPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
