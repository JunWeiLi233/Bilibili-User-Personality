from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.readme_stats import (
    ReadmeStatsCommandRequest,
    ReadmeStatsPayloadContractComparator as ReadmeStatsContractComparator,
    ReadmeStatsRunner,
)

def build_parser() -> argparse.ArgumentParser:
    return ReadmeStatsCommandRequest.parser()


class ReadmeStatsCliRunner(ReadmeStatsCommandRequest):
    """CLI-compatible README stats runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = ReadmeStatsCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
