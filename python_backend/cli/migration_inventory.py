from __future__ import annotations

import argparse
import sys

from python_backend.analysis.migration_inventory import BackendMigrationInventoryCommandRequest
from python_backend.runtime.json_contracts import JsonResultBytesContract


class BackendMigrationInventoryCliRunner(BackendMigrationInventoryCommandRequest):
    """CLI-compatible backend migration inventory runner."""


def build_parser() -> argparse.ArgumentParser:
    return BackendMigrationInventoryCommandRequest.parser()


def main(argv: list[str] | None = None) -> int:
    result = BackendMigrationInventoryCliRunner(argv).run()
    return JsonResultBytesContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
