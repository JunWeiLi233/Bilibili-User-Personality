from __future__ import annotations

import argparse
import json
import sys

from python_backend.runtime.file_lock import FileLockStateCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return FileLockStateCommandRequest.parser()


class FileLockStateCliRunner(FileLockStateCommandRequest):
    """CLI-compatible file-lock state runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = FileLockStateCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
