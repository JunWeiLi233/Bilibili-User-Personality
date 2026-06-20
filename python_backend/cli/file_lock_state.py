from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

from python_backend.runtime.file_lock import FileLockStateContractComparator, FileLockStateInspector


class FileLockStateRunner:
    """Emit a JS-compatible file-lock owner state report."""

    def __init__(
        self,
        lock_path: str | Path,
        *,
        stale_ms: int = 60000,
        now_ms: Callable[[], int] | None = None,
        process_alive: Callable[[int], bool] | None = None,
    ):
        self.lock_path = Path(lock_path)
        self.stale_ms = int(stale_ms)
        self.now_ms = now_ms
        self.process_alive = process_alive

    def run(self) -> dict[str, Any]:
        return FileLockStateInspector(
            self.lock_path,
            stale_ms=self.stale_ms,
            now_ms=self.now_ms,
            process_alive=self.process_alive,
        ).inspect()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect a JS-compatible file-lock owner.json state.")
    parser.add_argument("--lock", default="server/data/.keyword-harvest.lock")
    parser.add_argument("--stale-ms", type=int, default=60000)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible lock state report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = FileLockStateContractComparator(args.lock, args.compare_js_report, stale_ms=args.stale_ms).compare()
    else:
        result = FileLockStateRunner(args.lock, stale_ms=args.stale_ms).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
