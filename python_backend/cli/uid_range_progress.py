from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_range import (
    UidRangeProgressCommandRequest,
    UidRangeProgressPayloadContractComparator as UidRangeProgressContractComparator,
    UidRangeProgressRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return UidRangeProgressCommandRequest.parser()


class UidRangeProgressCliRunner(UidRangeProgressCommandRequest):
    """CLI-compatible UID range progress runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = UidRangeProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
